"""
Tests del health-check de Gateways, en particular el cruce con ZeroTier para
distinguir "túnel caído" (tunnel_down) de "RouterOS caído" (offline).
"""
import uuid
from contextlib import contextmanager
from unittest.mock import AsyncMock

import pytest

from app.models.gateway import Gateway
from app.services.mikrotik import health
from app.services.mikrotik.gateway_pool import GatewayConnectionError


def _gateway(zerotier_node_id: str | None = None) -> Gateway:
    return Gateway(
        id=uuid.uuid4(),
        name="GW-Test",
        ip="10.147.20.5",
        api_port=8728,
        api_username="api",
        password_enc="x",
        zerotier_node_id=zerotier_node_id,
    )


@pytest.fixture(autouse=True)
def _mock_redis(monkeypatch):
    mock = AsyncMock()
    mock.get = AsyncMock(return_value=None)
    mock.setex = AsyncMock(return_value=True)
    monkeypatch.setattr(health, "redis_client", mock)
    return mock


@pytest.fixture
def _router_unreachable(monkeypatch):
    @contextmanager
    def _raise_cm(_gateway):
        raise GatewayConnectionError("connection refused")
        yield  # pragma: no cover

    monkeypatch.setattr(health.gateway_pool, "connect_to", _raise_cm)


@pytest.mark.asyncio
async def test_router_down_without_zerotier_is_offline(_router_unreachable, monkeypatch):
    monkeypatch.setattr(
        health, "_check_zerotier_tunnel_sync", lambda _nid: pytest.fail("no debe consultarse")
    )
    status = await health.check_gateway_health(_gateway(zerotier_node_id=None))

    assert status.status == "offline"
    assert status.zerotier_checked is False
    assert status.zerotier_online is None


@pytest.mark.asyncio
async def test_tunnel_down_when_zerotier_node_offline(_router_unreachable, monkeypatch):
    monkeypatch.setattr(health, "_check_zerotier_tunnel_sync", lambda _nid: False)
    status = await health.check_gateway_health(_gateway(zerotier_node_id="abc1234567"))

    assert status.status == "tunnel_down"
    assert status.zerotier_checked is True
    assert status.zerotier_online is False
    assert "Túnel ZeroTier caído" in status.error


@pytest.mark.asyncio
async def test_router_offline_when_zerotier_node_online(_router_unreachable, monkeypatch):
    monkeypatch.setattr(health, "_check_zerotier_tunnel_sync", lambda _nid: True)
    status = await health.check_gateway_health(_gateway(zerotier_node_id="abc1234567"))

    assert status.status == "offline"
    assert status.zerotier_checked is True
    assert status.zerotier_online is True
    assert "túnel ZeroTier está operativo" in status.error


@pytest.mark.asyncio
async def test_tunnel_check_inconclusive_keeps_offline(_router_unreachable, monkeypatch):
    # ZeroTier deshabilitado / sin configurar / nodo ausente → None
    monkeypatch.setattr(health, "_check_zerotier_tunnel_sync", lambda _nid: None)
    status = await health.check_gateway_health(_gateway(zerotier_node_id="abc1234567"))

    assert status.status == "offline"
    assert status.zerotier_checked is False
    assert status.zerotier_online is None
