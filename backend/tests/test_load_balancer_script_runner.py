"""
Tests del ejecutor de scripts de balanceo — en particular la limpieza de una
aplicación anterior antes de volver a aplicar (evita reglas duplicadas).
"""
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from app.services.load_balancer.script_builder import WanLink, build_script
from app.services.load_balancer.script_runner import (
    LoadBalancerScriptError,
    apply_built_script,
)


class _FakeRouterOsApi:
    """Simula /ip/route, /ip/firewall/nat, /ip/firewall/mangle y /routing/table con estado previo."""

    def __init__(self):
        self.routes = [
            {".id": "*1", "comment": "ISPSETUP PCC WAN1 (ether1)"},
            {".id": "*2", "comment": "no tocar — ruta del cliente"},
        ]
        self.nat = [
            {".id": "*30", "comment": "ISPSETUP PCC WAN1 (ether1)"},
            {".id": "*31", "comment": "no tocar — NAT de otro uso"},
        ]
        self.mangle = [
            {".id": "*10", "comment": "ISPSETUP PCC WAN1 (ether1)"},
            {".id": "*11", "comment": "no tocar — mangle de otro uso"},
        ]
        self.tables = [
            {".id": "*20", "name": "ispsetup-wan1"},
            {".id": "*21", "name": "Starlink1Route"},
        ]
        self.removed: list[tuple[str, str]] = []
        self.added: list[tuple[str, dict]] = []

    def __call__(self, path, **kwargs):
        if path == "/ip/route/print":
            return list(self.routes)
        if path == "/ip/firewall/nat/print":
            return list(self.nat)
        if path == "/ip/firewall/mangle/print":
            return list(self.mangle)
        if path == "/routing/table/print":
            return list(self.tables)
        if path == "/ip/route/remove":
            self.removed.append(("route", kwargs[".id"]))
            return []
        if path == "/ip/firewall/nat/remove":
            self.removed.append(("nat", kwargs[".id"]))
            return []
        if path == "/ip/firewall/mangle/remove":
            self.removed.append(("mangle", kwargs[".id"]))
            return []
        if path == "/routing/table/remove":
            self.removed.append(("table", kwargs[".id"]))
            return []
        # Cualquier /add de la plantilla nueva.
        self.added.append((path, kwargs))
        return []


@pytest.fixture
def fake_lb():
    lb = MagicMock()
    lb.name = "LB Test"
    return lb


def test_apply_built_script_removes_only_ispsetup_tagged_entries(fake_lb, monkeypatch):
    fake_api = _FakeRouterOsApi()

    @contextmanager
    def _fake_connect(_device):
        yield fake_api

    import app.services.load_balancer.script_runner as script_runner_module
    monkeypatch.setattr(script_runner_module.router_pool, "connect_to", _fake_connect)

    links = [
        WanLink(interface="ether1", gateway="192.168.1.1"),
        WanLink(interface="ether2", gateway="192.168.2.1"),
    ]
    built = build_script("pcc", links)

    apply_built_script(fake_lb, built)

    assert ("route", "*1") in fake_api.removed
    assert ("nat", "*30") in fake_api.removed
    assert ("mangle", "*10") in fake_api.removed
    assert ("table", "*20") in fake_api.removed
    # Lo que no lleva el tag ISPSETUP (ni el prefijo ispsetup- en tablas) no se toca.
    assert ("route", "*2") not in fake_api.removed
    assert ("nat", "*31") not in fake_api.removed
    assert ("mangle", "*11") not in fake_api.removed
    assert ("table", "*21") not in fake_api.removed

    # Y se aplicaron los comandos nuevos de la plantilla.
    assert len(fake_api.added) == len(built.commands)


def test_apply_built_script_wraps_errors(fake_lb, monkeypatch):
    @contextmanager
    def _fake_connect(_device):
        raise Exception("timeout")
        yield  # pragma: no cover

    import app.services.load_balancer.script_runner as script_runner_module
    monkeypatch.setattr(script_runner_module.router_pool, "connect_to", _fake_connect)

    links = [
        WanLink(interface="ether1", gateway="192.168.1.1"),
        WanLink(interface="ether2", gateway="192.168.2.1"),
    ]
    built = build_script("pcc", links)

    with pytest.raises(LoadBalancerScriptError, match="timeout"):
        apply_built_script(fake_lb, built)
