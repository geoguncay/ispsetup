from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services.mikrotik.gateway_configuration import (
    GatewayConfigurationError,
    cleanup_gateway_configuration,
    configure_traffic_accounting,
)


def test_accounting_v6_uses_only_nms_ip(monkeypatch):
    api = MagicMock()
    api.side_effect = lambda command, **_: (
        [{"version": "6.49.17"}] if command == "/system/resource/print" else []
    )
    monkeypatch.setattr(
        "app.services.mikrotik.gateway_configuration.settings.NMS_SERVER_IP",
        "10.20.30.40",
    )

    configure_traffic_accounting(api, "accounting_v6")

    api.assert_any_call("/ip/traffic-flow/set", enabled="no")
    api.assert_any_call("/ip/accounting/set", enabled="yes")
    api.assert_any_call(
        "/ip/accounting/web-access/set",
        **{"accessible-via-web": "yes", "address": "10.20.30.40/32"},
    )


def test_traffic_flow_does_not_call_removed_accounting_menu_on_routeros_7(monkeypatch):
    api = MagicMock()
    api.side_effect = lambda command, **_: (
        [{"version": "7.20.1"}] if command == "/system/resource/print" else []
    )
    api.path.return_value.select.return_value.where.return_value = []
    monkeypatch.setattr(
        "app.services.mikrotik.gateway_configuration.settings.NMS_SERVER_IP",
        "10.20.30.40",
    )

    configure_traffic_accounting(api, "traffic_flow")

    called_commands = [call.args[0] for call in api.call_args_list]
    assert "/ip/accounting/set" not in called_commands
    assert "/ip/accounting/web-access/set" not in called_commands
    api.assert_any_call("/ip/traffic-flow/set", enabled="yes")


def test_queue_accounting_disables_traffic_flow_without_nms_ip(monkeypatch):
    api = MagicMock()
    api.side_effect = lambda command, **_: (
        [{"version": "7.20.1"}] if command == "/system/resource/print" else []
    )

    configure_traffic_accounting(api, "queue_accounting")

    api.assert_any_call("/ip/traffic-flow/set", enabled="no")
    assert "/ip/traffic-flow/target/set" not in [call.args[0] for call in api.call_args_list]


def test_none_disables_traffic_flow_without_nms_ip(monkeypatch):
    api = MagicMock()
    api.side_effect = lambda command, **_: (
        [{"version": "6.49.17"}] if command == "/system/resource/print" else []
    )

    configure_traffic_accounting(api, "none")

    api.assert_any_call("/ip/traffic-flow/set", enabled="no")
    assert "/ip/traffic-flow/target/set" not in [call.args[0] for call in api.call_args_list]


def test_accounting_v6_is_rejected_on_routeros_7(monkeypatch):
    api = MagicMock()
    api.side_effect = lambda command, **_: (
        [{"version": "7.20.1"}] if command == "/system/resource/print" else []
    )
    monkeypatch.setattr(
        "app.services.mikrotik.gateway_configuration.settings.NMS_SERVER_IP",
        "10.20.30.40",
    )

    with pytest.raises(GatewayConfigurationError, match="RouterOS 6"):
        configure_traffic_accounting(api, "accounting_v6")


def test_cleanup_removes_only_identified_nms_resources(monkeypatch):
    api = MagicMock()
    path_entries = {
        "/ip/hotspot/profile": [],
        "/radius": [{".id": "*r1", "address": "10.20.30.40"}],
        "/ip/traffic-flow/target": [
            {".id": "*t1", "dst-address": "10.20.30.40", "port": "2055"},
            {".id": "*t2", "dst-address": "10.20.30.50", "port": "2055"},
        ],
        "/queue/simple": [
            {".id": "*q1", "target": "192.168.1.10/32", "name": "Cliente"},
            {".id": "*q2", "target": "0.0.0.0/0", "name": "isp_padre_test"},
            {".id": "*q3", "target": "192.168.9.9/32", "name": "Ajena"},
        ],
        "/ip/firewall/address-list": [
            {".id": "*a1", "list": "isp_clientes_test", "address": "192.168.1.10"},
            {".id": "*a2", "list": "lista_ajena", "address": "192.168.9.9"},
        ],
        "/ip/dhcp-server/lease": [],
        "/queue/tree": [{".id": "*qt1", "name": "isp_pcq_upload"}],
        "/ip/firewall/mangle": [{".id": "*m1", "comment": "ISP NMS PCQ upload"}],
        "/queue/type": [{".id": "*ty1", "name": "isp_pcq_upload"}],
        "/ppp/active": [{".id": "*pa1", "name": "cliente_ppp"}],
        "/ppp/secret": [{".id": "*ps1", "name": "cliente_ppp"}],
        "/ppp/profile": [{".id": "*pp1", "name": "Plan 20M"}],
    }
    api.path.side_effect = lambda path: path_entries[path]
    connection = MagicMock()
    connection.__enter__.return_value = api
    monkeypatch.setattr(
        "app.services.mikrotik.gateway_configuration.gateway_pool.connect_to",
        MagicMock(return_value=connection),
    )
    monkeypatch.setattr(
        "app.services.mikrotik.gateway_configuration.settings.NMS_SERVER_IP",
        "10.20.30.40",
    )
    gateway = SimpleNamespace(
        name="Gateway Test",
        address_list="test",
        suspend_list="isp_suspendidos_test",
        parent_queue="test",
    )

    summary = cleanup_gateway_configuration(
        gateway,
        client_ips=["192.168.1.10"],
        ppp_usernames=["cliente_ppp"],
        ppp_profile_names=["Plan 20M"],
    )

    assert summary["simple_queues"] == 2
    assert summary["address_list_entries"] == 1
    assert summary["pcq_rules"] == 3
    api.assert_any_call("/radius/remove", **{".id": "*r1"})
    api.assert_any_call("/ip/traffic-flow/target/remove", **{".id": "*t1"})
    api.assert_any_call("/queue/simple/remove", **{".id": "*q1"})
    api.assert_any_call("/queue/simple/remove", **{".id": "*q2"})
    assert not any(call.args == ("/queue/simple/remove",) and call.kwargs.get(".id") == "*q3" for call in api.call_args_list)
