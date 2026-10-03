"""
Tests del generador de scripts de balanceo (PCC / Failover), puros — sin tocar RouterOS.
"""
import pytest

from app.services.load_balancer.script_builder import (
    ScriptBuilderError,
    WanLink,
    build_script,
)


def test_pcc_requires_at_least_two_links():
    with pytest.raises(ScriptBuilderError, match="al menos 2 enlaces"):
        build_script("pcc", [WanLink(interface="ether1", gateway="192.168.1.1")])


def test_pcc_rejects_duplicate_interfaces():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1"),
        WanLink(interface="ether1", gateway="192.168.2.1"),
    ]
    with pytest.raises(ScriptBuilderError, match="repetir la misma interfaz"):
        build_script("pcc", links)


def test_unknown_algorithm_raises():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1"),
        WanLink(interface="ether2", gateway="192.168.2.1"),
    ]
    with pytest.raises(ScriptBuilderError, match="desconocido"):
        build_script("round-robin", links)


def test_pcc_creates_one_routing_table_per_link_with_fib():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1"),
        WanLink(interface="ether2", gateway="192.168.2.1"),
    ]
    built = build_script("pcc", links)

    table_cmds = [c for c in built.commands if c[0] == "/routing/table/add"]
    assert [c[1]["name"] for c in table_cmds] == ["ispsetup-wan1", "ispsetup-wan2"]
    assert all(c[1]["fib"] == "yes" for c in table_cmds)
    # /routing/table no admite `comment` en el equipo real — no debe mandarse.
    assert all("comment" not in c[1] for c in table_cmds)


def test_pcc_equal_weight_uses_single_remainder_per_link():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1"),
        WanLink(interface="ether2", gateway="192.168.2.1"),
    ]
    built = build_script("pcc", links)

    mark_connection_cmds = [c for c in built.commands if c[1].get("action") == "mark-connection"]
    # Un resto por enlace (sin pesos extra) — nunca un rango como "0-1".
    assert len(mark_connection_cmds) == 2
    assert mark_connection_cmds[0][1]["per-connection-classifier"] == "both-addresses-and-ports:2/0"
    assert mark_connection_cmds[1][1]["per-connection-classifier"] == "both-addresses-and-ports:2/1"

    mark_routing_cmds = [c for c in built.commands if c[1].get("action") == "mark-routing"]
    assert mark_routing_cmds[0][1]["new-routing-mark"] == "ispsetup-wan1"
    assert mark_routing_cmds[1][1]["new-routing-mark"] == "ispsetup-wan2"

    # Las rutas usan `routing-table` (RouterOS v7), no `routing-mark` (v6).
    table_route_cmds = [c for c in built.commands if c[0] == "/ip/route/add" and "routing-table" in c[1]]
    assert table_route_cmds[0][1]["routing-table"] == "ispsetup-wan1"
    assert table_route_cmds[0][1]["gateway"] == "192.168.1.1"
    assert table_route_cmds[1][1]["routing-table"] == "ispsetup-wan2"
    assert table_route_cmds[1][1]["gateway"] == "192.168.2.1"


def test_pcc_weighted_links_generate_one_rule_per_remainder_never_a_range():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1", weight=2),
        WanLink(interface="ether2", gateway="192.168.2.1", weight=1),
    ]
    built = build_script("pcc", links)

    mark_connection_cmds = [c for c in built.commands if c[1].get("action") == "mark-connection"]
    # total_weight=3: WAN1 recibe 2 restos (reglas separadas), WAN2 recibe 1.
    assert len(mark_connection_cmds) == 3
    classifiers = [c[1]["per-connection-classifier"] for c in mark_connection_cmds]
    assert classifiers == [
        "both-addresses-and-ports:3/0",
        "both-addresses-and-ports:3/1",
        "both-addresses-and-ports:3/2",
    ]
    # Ningún resto debe ser un rango — RouterOS lo rechaza ("invalid value 0-1 for remainder").
    assert all("-" not in c.split("/")[-1] for c in classifiers)
    assert [c[1]["new-connection-mark"] for c in mark_connection_cmds] == ["wan1-conn", "wan1-conn", "wan2-conn"]


def test_pcc_weights_are_reduced_by_gcd_to_minimize_rules():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1", weight=10),
        WanLink(interface="ether2", gateway="192.168.2.1", weight=10),
        WanLink(interface="ether3", gateway="192.168.3.1", weight=2),
    ]
    built = build_script("pcc", links)

    mark_connection_cmds = [c for c in built.commands if c[1].get("action") == "mark-connection"]
    # [10, 10, 2] se reduce a [5, 5, 1] (gcd=2) en vez de generar 22 reglas.
    assert len(mark_connection_cmds) == 11


def test_pcc_rejects_weights_that_would_generate_too_many_rules():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1", weight=100),
        WanLink(interface="ether2", gateway="192.168.2.1", weight=1),
    ]
    with pytest.raises(ScriptBuilderError, match="proporción más simple"):
        build_script("pcc", links)


def test_pcc_adds_masquerade_for_every_wan_interface():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1"),
        WanLink(interface="ether2", gateway="192.168.2.1"),
    ]
    built = build_script("pcc", links)

    nat_cmds = [c for c in built.commands if c[0] == "/ip/firewall/nat/add"]
    assert len(nat_cmds) == 2
    assert all(c[1]["chain"] == "srcnat" and c[1]["action"] == "masquerade" for c in nat_cmds)
    assert [c[1]["out-interface"] for c in nat_cmds] == ["ether1", "ether2"]


def test_failover_orders_by_priority_with_staggered_distance():
    links = [
        WanLink(interface="ether2", gateway="192.168.2.1", priority=1),
        WanLink(interface="ether1", gateway="192.168.1.1", priority=0),
    ]
    built = build_script("failover", links)

    route_cmds = [c for c in built.commands if c[0] == "/ip/route/add"]
    assert len(route_cmds) == 2
    assert route_cmds[0][1]["gateway"] == "192.168.1.1"
    assert route_cmds[0][1]["distance"] == "1"
    assert "principal" in route_cmds[0][1]["comment"]
    assert route_cmds[1][1]["gateway"] == "192.168.2.1"
    assert route_cmds[1][1]["distance"] == "2"
    assert "respaldo 1" in route_cmds[1][1]["comment"]
    assert all(c[1]["check-gateway"] == "ping" for c in route_cmds)


def test_failover_adds_masquerade_for_every_wan_interface():
    links = [
        WanLink(interface="ether2", gateway="192.168.2.1", priority=1),
        WanLink(interface="ether1", gateway="192.168.1.1", priority=0),
    ]
    built = build_script("failover", links)

    nat_cmds = [c for c in built.commands if c[0] == "/ip/firewall/nat/add"]
    assert len(nat_cmds) == 2
    assert all(c[1]["chain"] == "srcnat" and c[1]["action"] == "masquerade" for c in nat_cmds)
    assert {c[1]["out-interface"] for c in nat_cmds} == {"ether1", "ether2"}


def test_built_script_text_matches_commands():
    links = [
        WanLink(interface="ether1", gateway="192.168.1.1"),
        WanLink(interface="ether2", gateway="192.168.2.1"),
    ]
    built = build_script("failover", links)
    lines = built.text.splitlines()

    assert lines[0] == "# Generado por ISPSETUP — balanceo FAILOVER"
    assert len(lines) == 1 + len(built.commands)
    assert lines[1].startswith("/ip/route/add ")
    assert 'gateway="192.168.1.1"' in lines[1]
