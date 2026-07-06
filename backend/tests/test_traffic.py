import pytest
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import ANY, AsyncMock, MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.core import database as db_module
from app.core.database import Base
from app.core.deps import get_db
from app.core.security import hash_password
from app.main import app
from app.models.user import User
from app.models.gateway import Gateway
from app.models.client import Client
from app.models.static_ip import StaticIP
from app.models.traffic_sample import TrafficSample
from app.workers.traffic import poll_traffic, ensure_partition_exists

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

    # Mock pubsub
    pubsub_mock = AsyncMock()
    pubsub_mock.subscribe = AsyncMock(return_value=True)
    from unittest.mock import MagicMock as UMMagicMock
    pubsub_mock.listen = UMMagicMock()
    pubsub_mock.unsubscribe = AsyncMock(return_value=True)
    pubsub_mock.close = AsyncMock(return_value=True)

    # listen returns a generator yielding items
    async def listen_gen():
        yield {"type": "message", "data": '{"test": "data"}'}
    pubsub_mock.listen.side_effect = listen_gen

    mock.pubsub = MagicMock(return_value=pubsub_mock)
    return mock


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setattr(db_module, "engine", engine_test)
    monkeypatch.setattr(db_module, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr("app.api.auth.redis_client", make_redis_mock())
    monkeypatch.setattr("app.api.traffic_api.redis_client", make_redis_mock())
    monkeypatch.setattr("app.workers.traffic.redis_client", make_redis_mock())

    Base.metadata.create_all(bind=engine_test)

    db = TestingSessionLocal()
    # Agregar un administrador
    db.add(User(
        name="Test Admin",
        email="admin@test.com",
        hashed_password=hash_password("adminpass123"),
        role="admin",
        active=True,
    ))
    # Agregar un gateway
    r = Gateway(
        name="Router Monitoreado",
        ip="10.0.0.1",
        api_port=8728,
        api_username="admin",
        password_enc="enc_pass",
        active=True,
    )
    db.add(r)
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


def test_ensure_partition_exists():
    db = TestingSessionLocal()
    # En SQLite debe retornar "traffic_samples" y no lanzar errores DDL de particionamiento
    res = ensure_partition_exists(db, datetime.now())
    assert res == "traffic_samples"
    db.close()


@patch("app.workers.traffic.gateway_pool.connect_to")
def test_poll_traffic_task(mock_connect_to):
    # Setup mocks de MikroTik API
    api_mock = MagicMock()
    # Mocking simple queues
    api_mock.path.return_value.select.return_value.where.return_value = []

    # list(api.path('/queue/simple'))
    # list(api("/interface/print"))
    def api_side_effect(cmd, *args, **kwargs):
        if cmd == "/interface/print":
            return [
                {"name": "ether1", "type": "ether", "running": "true", "disabled": "false", "rx-byte": 1000, "tx-byte": 2000},
                {"name": "wlan1", "type": "wlan", "running": "false", "disabled": "true", "rx-byte": 0, "tx-byte": 0}
            ]
        elif cmd == "/system/resource/print":
            return [{"version": "6.48", "uptime": "1d2h"}]
        return []

    api_mock.side_effect = api_side_effect

    # Para /queue/simple
    def path_side_effect(path):
        path_mock = MagicMock()
        if path == "/queue/simple":
            path_mock.select.return_value = []
            # librouteros path call can be converted to list, so we make it return list of dicts
            return [
                {"name": "Juan Perez", "target": "192.168.10.15/32", "rate": "128000/256000", "bytes": "500000/600000", "disabled": "false"}
            ]
        return path_mock

    api_mock.path.side_effect = path_side_effect

    mock_connect_to.return_value.__enter__.return_value = api_mock

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()

    # Crear cliente activo con IP estática en este router
    c = Client(
        name="Juan Perez",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    db.add(c)
    db.flush()
    db.add(StaticIP(client_id=c.id, ip="192.168.10.15", gateway_id=gateway.id))
    db.commit()
    db.close()

    # Ejecutar la tarea de recolección de tráfico
    poll_traffic()

    # Verificar que se insertaron muestras en la BD
    db = TestingSessionLocal()
    samples = db.query(TrafficSample).all()
    assert len(samples) > 0

    # Debe haber una muestra del cliente Juan Perez
    client_sample = db.query(TrafficSample).filter(TrafficSample.client_id != None).first()
    assert client_sample is not None
    assert client_sample.rx_rate == 256000
    assert client_sample.tx_rate == 128000
    assert client_sample.rx_bytes == 600000
    assert client_sample.tx_bytes == 500000

    # Debe haber una muestra de la interfaz ether1
    iface_sample = db.query(TrafficSample).filter(TrafficSample.interface_name == "ether1").first()
    assert iface_sample is not None
    assert iface_sample.rx_bytes == 1000
    assert iface_sample.tx_bytes == 2000

    db.close()


def test_get_client_traffic_history_api(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()

    c = Client(
        name="Juan Perez",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    db.add(c)
    db.flush()
    client_id = c.id

    # Sembrar muestras de tráfico para este cliente en diferentes minutos del pasado
    now = datetime.now(timezone.utc)
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=client_id,
        rx_bytes=1000,
        tx_bytes=500,
        rx_rate=500000,
        tx_rate=200000,
        timestamp=now - timedelta(minutes=5)
    ))
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=client_id,
        rx_bytes=2000,
        tx_bytes=1000,
        rx_rate=600000,
        tx_rate=300000,
        timestamp=now - timedelta(minutes=1)
    ))
    db.commit()
    db.close()

    # Consultar histórico
    response = client.get(
        f"/api/traffic/client/{client_id}",
        params={"range": "1h"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["client_id"] == str(client_id)
    assert data["range"] == "1h"
    assert len(data["samples"]) == 2
    # Orden cronológico
    assert data["samples"][0]["rx_rate"] == 500000.0
    assert data["samples"][1]["rx_rate"] == 600000.0


def test_websocket_traffic_unauthorized(client: TestClient):
    # Sin token
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(f"/api/traffic/ws/{uuid.uuid4()}") as websocket:
            websocket.receive_json()
    assert exc_info.value.code == 1008


def test_websocket_traffic_authorized(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    gateway_id = gateway.id
    db.close()

    with client.websocket_connect(f"/api/traffic/ws/{gateway_id}?token={token}") as websocket:
        data = websocket.receive_json()
        assert data == {"test": "data"}


def test_get_router_traffic_history_api(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()

    # Crear dos clientes
    c1 = Client(
        name="Juan Perez",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    c2 = Client(
        name="Maria Gomez",
        cedula="1724024889",
        phone="0999999998",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    db.add(c1)
    db.add(c2)
    db.flush()

    # Sembrar muestras de tráfico para ambos clientes en los mismos timestamps del pasado para agregarse
    now = datetime.now(timezone.utc)
    ts1 = now - timedelta(minutes=5)
    ts2 = now - timedelta(minutes=1)

    # En ts1, c1 consume 500k y c2 consume 300k -> Total 800k
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=c1.id,
        rx_bytes=1000,
        tx_bytes=500,
        rx_rate=500000,
        tx_rate=200000,
        timestamp=ts1
    ))
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=c2.id,
        rx_bytes=500,
        tx_bytes=300,
        rx_rate=300000,
        tx_rate=100000,
        timestamp=ts1
    ))

    # En ts2, c1 consume 600k y c2 consume 400k -> Total 1000k
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=c1.id,
        rx_bytes=2000,
        tx_bytes=1000,
        rx_rate=600000,
        tx_rate=300000,
        timestamp=ts2
    ))
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=c2.id,
        rx_bytes=1000,
        tx_bytes=600,
        rx_rate=400000,
        tx_rate=200000,
        timestamp=ts2
    ))

    gateway_id = gateway.id
    db.commit()
    db.close()

    # Consultar histórico del router
    response = client.get(
        f"/api/traffic/gateway/{gateway_id}",
        params={"range": "1h"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    # El primer timestamp agregado debe ser c1 (500k) + c2 (300k) = 800k rx_rate
    assert data[0]["rx_rate"] == 800000.0
    # El segundo timestamp agregado debe ser c1 (600k) + c2 (400k) = 1M rx_rate
    assert data[1]["rx_rate"] == 1000000.0
