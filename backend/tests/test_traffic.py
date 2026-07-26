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
from app.workers.traffic import (
    calculate_client_deltas,
    poll_traffic,
    ensure_partition_exists,
)

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
    # poll_traffic crea un cliente Redis ligado a su propio event loop.
    monkeypatch.setattr("redis.asyncio.from_url", lambda *args, **kwargs: make_redis_mock())

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
    # Agregar un gateway. traffic_accounting se fija explícitamente en
    # 'queue_accounting' porque estas pruebas ejercitan la recolección vía
    # Simple Queues; el modo 'traffic_flow' la omite (ver test_netflow_collector.py
    # y test_poll_traffic_skips_simple_queues_for_traffic_flow_gateway más abajo).
    r = Gateway(
        name="Router Monitoreado",
        ip="10.0.0.1",
        api_port=8728,
        api_username="admin",
        password_enc="enc_pass",
        active=True,
        traffic_accounting="queue_accounting",
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
        full_name="Juan Perez",
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
    # La primera lectura establece la línea base y no atribuye todo el contador
    # acumulado del MikroTik al período actual.
    assert client_sample.rx_delta_bytes == 0
    assert client_sample.tx_delta_bytes == 0

    # Debe haber una muestra de la interfaz ether1
    iface_sample = db.query(TrafficSample).filter(TrafficSample.interface_name == "ether1").first()
    assert iface_sample is not None
    assert iface_sample.rx_bytes == 1000
    assert iface_sample.tx_bytes == 2000

    db.close()


@patch("app.workers.traffic.gateway_pool.connect_to")
def test_poll_traffic_skips_simple_queues_for_traffic_flow_gateway(mock_connect_to):
    """Un Gateway en modo 'traffic_flow' no debe generar TrafficSample por
    cliente vía Simple Queues (eso ahora lo hace el colector NetFlow), pero
    sí debe seguir reportando el consumo de sus interfaces."""
    api_mock = MagicMock()

    def api_side_effect(cmd, *args, **kwargs):
        if cmd == "/interface/print":
            return [
                {"name": "ether1", "type": "ether", "running": "true", "disabled": "false", "rx-byte": 111, "tx-byte": 222},
            ]
        elif cmd == "/system/resource/print":
            return [{"version": "7.15", "uptime": "1d2h"}]
        return []

    api_mock.side_effect = api_side_effect

    def path_side_effect(path):
        if path == "/queue/simple":
            return [
                {"name": "Cliente NetFlow", "target": "192.168.20.5/32", "rate": "1000/2000", "bytes": "3000/4000", "disabled": "false"}
            ]
        return MagicMock()

    api_mock.path.side_effect = path_side_effect
    mock_connect_to.return_value.__enter__.return_value = api_mock

    db = TestingSessionLocal()
    gw = Gateway(
        name="Router NetFlow",
        ip="10.0.0.2",
        api_port=8728,
        api_username="admin",
        password_enc="enc_pass",
        active=True,
        traffic_accounting="traffic_flow",
    )
    db.add(gw)
    db.flush()
    c = Client(
        full_name="Cliente NetFlow",
        cedula="1724024890",
        phone="0999999996",
        address="Quito",
        gateway_id=gw.id,
        connection_type="static",
        active=True,
    )
    db.add(c)
    db.flush()
    db.add(StaticIP(client_id=c.id, ip="192.168.20.5", gateway_id=gw.id))
    gateway_id = gw.id
    db.commit()
    db.close()

    poll_traffic()

    db = TestingSessionLocal()
    client_samples = db.query(TrafficSample).filter(
        TrafficSample.gateway_id == gateway_id, TrafficSample.client_id.isnot(None)
    ).all()
    assert client_samples == []

    iface_samples = db.query(TrafficSample).filter(
        TrafficSample.gateway_id == gateway_id, TrafficSample.interface_name == "ether1"
    ).all()
    assert len(iface_samples) == 1
    assert iface_samples[0].rx_bytes == 111
    assert iface_samples[0].tx_bytes == 222
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
        full_name="Juan Perez",
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

    # Sembrar muestras dentro de la hora calendario actual.
    now = datetime.now(timezone.utc)
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=client_id,
        rx_bytes=1000,
        tx_bytes=500,
        rx_delta_bytes=1000,
        tx_delta_bytes=500,
        rx_rate=500000,
        tx_rate=200000,
        timestamp=now - timedelta(seconds=10)
    ))
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=client_id,
        rx_bytes=2000,
        tx_bytes=1000,
        rx_delta_bytes=1000,
        tx_delta_bytes=500,
        rx_rate=600000,
        tx_rate=300000,
        timestamp=now - timedelta(seconds=5)
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
    assert data["period_mode"] == "calendar"
    assert len(data["samples"]) >= 1
    assert data["totals"] == {
        "download_bytes": 2000,
        "upload_bytes": 1000,
        "total_bytes": 3000,
    }
    assert data["gaps"]
    period_start = datetime.fromisoformat(data["start"])
    period_end = datetime.fromisoformat(data["end"])
    assert period_start.minute == 0
    assert period_start.second == 0
    assert period_end - period_start == timedelta(hours=1)

    rolling_response = client.get(
        f"/api/traffic/client/{client_id}",
        params={"range": "1h", "period_mode": "rolling"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert rolling_response.status_code == 200
    rolling = rolling_response.json()
    rolling_start = datetime.fromisoformat(rolling["start"])
    rolling_end = datetime.fromisoformat(rolling["end"])
    assert rolling["period_mode"] == "rolling"
    assert rolling_end - rolling_start == timedelta(hours=1)


def test_get_client_traffic_custom_range(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    customer = Client(
        full_name="Cliente Rango",
        cedula="1724024999",
        phone="0999999997",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True,
    )
    db.add(customer)
    db.flush()
    timestamp = datetime.now(timezone.utc) - timedelta(days=2)
    db.add(TrafficSample(
        gateway_id=gateway.id,
        client_id=customer.id,
        rx_bytes=5000,
        tx_bytes=2000,
        rx_delta_bytes=1500,
        tx_delta_bytes=500,
        rx_rate=1000,
        tx_rate=500,
        timestamp=timestamp,
    ))
    customer_id = customer.id
    db.commit()
    db.close()

    response = client.get(
        f"/api/traffic/client/{customer_id}",
        params={
            "range": "custom",
            "start": (timestamp - timedelta(hours=1)).isoformat(),
            "end": (timestamp + timedelta(hours=1)).isoformat(),
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["range"] == "custom"
    assert data["totals"]["total_bytes"] == 2000
    assert len(data["samples"]) == 1


def test_calculate_client_deltas_handles_counter_reset():
    redis_mock = AsyncMock()
    redis_mock.get = AsyncMock(side_effect=[
        '{"rx_bytes": 1000, "tx_bytes": 800, "ts": 1}',
        '{"rx_bytes": 2000, "tx_bytes": 1500, "ts": 2}',
    ])
    redis_mock.setex = AsyncMock(return_value=True)
    gateway_id = uuid.uuid4()
    client_id = uuid.uuid4()

    samples = [
        {
            "client_id": client_id,
            "rx_bytes": 1400,
            "tx_bytes": 1000,
        },
        {
            "client_id": uuid.uuid4(),
            "rx_bytes": 250,
            "tx_bytes": 100,
        },
    ]
    enriched = __import__("asyncio").run(
        calculate_client_deltas(
            gateway_id, samples, datetime.now(timezone.utc), redis_mock
        )
    )

    assert enriched[0]["rx_delta_bytes"] == 400
    assert enriched[0]["tx_delta_bytes"] == 200
    # Al reiniciarse el contador, el valor actual es el volumen desde el reinicio.
    assert enriched[1]["rx_delta_bytes"] == 250
    assert enriched[1]["tx_delta_bytes"] == 100


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
        full_name="Juan Perez",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    c2 = Client(
        full_name="Maria Gomez",
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
