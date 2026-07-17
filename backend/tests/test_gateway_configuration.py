from unittest.mock import MagicMock

from app.services.mikrotik.gateway_configuration import configure_traffic_accounting


def test_accounting_v6_uses_only_nms_ip(monkeypatch):
    api = MagicMock()
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
