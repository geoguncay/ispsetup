"""
Tests del monitoreo de interfaces de balanceadores de carga: tarea Celery de
sondeo, snapshot cacheado en Redis (GET .../interfaces) y WebSocket en vivo.
"""
import uuid
from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import database as db_module
from app.core.database import Base
from app.core.deps import get_db
from app.core.security import hash_password
from app.main import app
from app.models.user import User
from app.models.load_balancer import LoadBalancer
from app.models.load_balancer_interface_sample import LoadBalancerInterfaceSample
from app.workers.lb_traffic import ensure_partition_exists, poll_lb_interfaces

engine_test = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def make_redis_mock() -> AsyncMock:
    mock = AsyncMock()
    mock.setex = AsyncMock(return_value=True)
    mock.get = AsyncMock(return_value=None)
    mock.delete = AsyncMock(return_value=True)
    mock.publish = AsyncMock(return_value=True)

    pubsub_mock = AsyncMock()
    pubsub_mock.subscribe = AsyncMock(return_value=True)
    pubsub_mock.listen = MagicMock()
    pubsub_mock.unsubscribe = AsyncMock(return_value=True)
    pubsub_mock.close = AsyncMock(return_value=True)

    async def listen_gen():
        yield {"type": "message", "data": '{"test": "data"}'}

    pubsub_mock.listen.return_value = listen_gen()
    mock.pubsub = MagicMock(return_value=pubsub_mock)
    return mock


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setattr(db_module, "engine", engine_test)
    monkeypatch.setattr(db_module, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr("app.api.auth.redis_client", make_redis_mock())
    monkeypatch.setattr("app.api.load_balancers_api.redis_client", make_redis_mock())
    monkeypatch.setattr("redis.asyncio.from_url", lambda *args, **kwargs: make_redis_mock())

    Base.metadata.create_all(bind=engine_test)

    db = TestingSessionLocal()
    db.add(User(
        name="Test Admin",
        email="admin@test.com",
        hashed_password=hash_password("adminpass123"),
        role="admin",
        active=True,
    ))
    db.add(LoadBalancer(
        name="LB Monitoreo",
        ip="10.0.0.70",
        api_port=8728,
        api_username="admin",
        password_enc="encrypted",
        active=True,
    ))
    db.commit()
    db.close()

    yield

    Base.metadata.drop_all(bind=engine_test)


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _admin_headers(client: TestClient) -> dict:
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_ensure_partition_exists_lb():
    db = TestingSessionLocal()
    res = ensure_partition_exists(db, __import__("datetime").datetime.now())
    assert res == "lb_interface_samples"
    db.close()


@patch("app.workers.lb_traffic.router_pool.connect_to")
def test_poll_lb_interfaces_reports_all_interfaces_including_down(mock_connect_to):
    api_mock = MagicMock()

    def api_side_effect(cmd, *args, **kwargs):
        if cmd == "/interface/print":
            return [
                {"name": "wan1", "running": "true", "disabled": "false", "rx-byte": 1000, "tx-byte": 2000},
                {"name": "wan2", "running": "false", "disabled": "true", "rx-byte": 0, "tx-byte": 0},
            ]
        return []

    api_mock.side_effect = api_side_effect
    mock_connect_to.return_value.__enter__.return_value = api_mock

    poll_lb_interfaces()

    db = TestingSessionLocal()
    samples = db.query(LoadBalancerInterfaceSample).all()
    db.close()

    # A diferencia del polling de Router, aquí NO se filtran las interfaces
    # caídas/deshabilitadas — deben quedar ambas.
    assert len(samples) == 2
    wan1 = next(s for s in samples if s.interface_name == "wan1")
    wan2 = next(s for s in samples if s.interface_name == "wan2")
    assert wan1.running is True and wan1.disabled is False
    assert wan1.rx_bytes == 1000 and wan1.tx_bytes == 2000
    assert wan2.running is False and wan2.disabled is True


def test_get_interfaces_endpoint_returns_cached_snapshot(client: TestClient, monkeypatch):
    headers = _admin_headers(client)
    db = TestingSessionLocal()
    lb = db.query(LoadBalancer).first()
    lb_id = lb.id
    db.close()

    snapshot = [
        {"name": "wan1", "running": True, "disabled": False, "rx_bytes": 100, "tx_bytes": 200, "rx_rate": 1000, "tx_rate": 2000},
    ]

    async def fake_get(key):
        assert key == f"lb:interfaces:{lb_id}"
        import json
        return json.dumps(snapshot)

    import app.api.load_balancers_api as lb_api
    monkeypatch.setattr(lb_api.redis_client, "get", fake_get)

    response = client.get(f"/api/load-balancers/{lb_id}/interfaces", headers=headers)
    assert response.status_code == 200
    assert response.json() == snapshot


def test_get_interfaces_endpoint_empty_when_not_polled_yet(client: TestClient):
    headers = _admin_headers(client)
    db = TestingSessionLocal()
    lb_id = db.query(LoadBalancer).first().id
    db.close()

    response = client.get(f"/api/load-balancers/{lb_id}/interfaces", headers=headers)
    assert response.status_code == 200
    assert response.json() == []


def test_websocket_lb_traffic_unauthorized(client: TestClient):
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/api/load-balancers/ws/{uuid.uuid4()}") as websocket:
            websocket.receive_json()
    assert exc_info.value.code == 1008


def test_websocket_lb_traffic_authorized(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    lb_id = db.query(LoadBalancer).first().id
    db.close()

    with client.websocket_connect(f"/api/load-balancers/ws/{lb_id}?token={token}") as websocket:
        data = websocket.receive_json()
        assert data == {"test": "data"}
