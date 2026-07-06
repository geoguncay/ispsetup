import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import AsyncMock, patch

from app.core import database as db_module
from app.core.database import Base
from app.core.deps import get_db
from app.core.security import hash_password
from app.main import app
from app.models.user import User
from app.models.gateway import Gateway
from app.models.client import Client
from app.models.static_ip import StaticIP

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
    return mock


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setattr(db_module, "engine", engine_test)
    monkeypatch.setattr(db_module, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr("app.api.auth.redis_client", make_redis_mock())

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
    # Agregar dos gateways
    r1 = Gateway(
        name="Router Quito",
        ip="10.0.0.1",
        api_port=8728,
        api_username="admin",
        password_enc="enc_pass",
        active=True,
    )
    r2 = Gateway(
        name="Router Guayaquil",
        ip="10.0.0.2",
        api_port=8728,
        api_username="admin",
        password_enc="enc_pass",
        active=True,
    )
    db.add(r1)
    db.add(r2)
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


@patch("app.api.clients.sync_ip_in_address_list")
def test_create_client_static_ip_success(mock_sync, client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).filter(Gateway.name == "Router Quito").first()
    gateway_id = str(gateway.id)
    db.close()

    response = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Alex Guncay",
            "cedula": "1724024888",
            "phone": "0999999999",
            "address": "Av. Amazonas, Quito",
            "gateway_id": gateway_id,
            "connection_type": "static",
            "ip": "192.168.10.50",
            "mac": "11:22:33:44:55:66",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["static_ip"]["ip"] == "192.168.10.50"
    assert data["static_ip"]["mac"] == "11:22:33:44:55:66"
    assert mock_sync.call_count == 1


@patch("app.api.clients.sync_ip_in_address_list")
def test_static_ip_duplication_validation(mock_sync, client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    g_quito = db.query(Gateway).filter(Gateway.name == "Router Quito").first()
    g_gye = db.query(Gateway).filter(Gateway.name == "Router Guayaquil").first()
    g_quito_id = str(g_quito.id)
    g_gye_id = str(g_gye.id)
    db.close()

    # 1. Crear primer cliente con IP 192.168.1.100 en Router Quito (Succeeds)
    resp1 = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Cliente A",
            "cedula": "1724024888",
            "phone": "0999999999",
            "address": "Sector A",
            "gateway_id": g_quito_id,
            "connection_type": "static",
            "ip": "192.168.1.100",
        },
    )
    assert resp1.status_code == 201

    # 2. Intentar crear segundo cliente con misma IP en Router Quito (Fails)
    resp2 = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Cliente B",
            "cedula": "0926079971",
            "phone": "0988888888",
            "address": "Sector B",
            "gateway_id": g_quito_id,
            "connection_type": "static",
            "ip": "192.168.1.100",
        },
    )
    assert resp2.status_code == 400
    assert "ya está asignada" in resp2.json()["detail"]

    # 3. Crear cliente con misma IP en Router Guayaquil (Succeeds)
    resp3 = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Cliente C",
            "cedula": "0926079971",
            "phone": "0988888888",
            "address": "Sector B",
            "gateway_id": g_gye_id,
            "connection_type": "static",
            "ip": "192.168.1.100",
        },
    )
    assert resp3.status_code == 201


@patch("app.api.clients.remove_ip_from_address_list")
@patch("app.api.clients.sync_ip_in_address_list")
def test_update_client_ip_sync(mock_sync, mock_remove, client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    g = db.query(Gateway).first()
    gateway_id = str(g.id)
    db.close()

    # Crear cliente
    c_resp = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Carlos Perez",
            "cedula": "1724024888",
            "phone": "0999999999",
            "address": "Dir A",
            "gateway_id": gateway_id,
            "connection_type": "static",
            "ip": "192.168.1.50",
        },
    )
    client_id = c_resp.json()["id"]
    mock_sync.reset_mock()

    # Cambiar IP
    u_resp = client.put(
        f"/api/clients/{client_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "ip": "192.168.1.60",
        },
    )
    assert u_resp.status_code == 200
    assert u_resp.json()["static_ip"]["ip"] == "192.168.1.60"

    # Debe remover la IP anterior e ingresar la nueva
    assert mock_remove.call_count == 1
    assert mock_sync.call_count == 1


@patch("app.api.gateways_api.fetch_clients_from_address_list")
def test_import_clients_from_router(mock_fetch, client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    g = db.query(Gateway).first()
    gateway_uuid = g.id
    gateway_id = str(g.id)
    db.close()

    # Mock response from router address-list
    mock_fetch.return_value = [
        {"ip": "192.168.50.10", "comment": "Imported User A"},
        {"ip": "192.168.50.11", "comment": "Imported User B"},
        {"ip": "192.168.50.12", "comment": ""}, # empty comment
    ]

    response = client.post(
        f"/api/gateways/{gateway_id}/import-clients",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["imported_count"] == 3

    # Verificar que los clientes fueron agregados a la DB
    db = TestingSessionLocal()
    clients = db.query(Client).filter(Client.gateway_id == gateway_uuid).all()
    assert len(clients) == 3
    assert clients[0].name == "Imported User A"
    assert clients[2].name == "Importado IP 192.168.50.12"
    # Cédulas generadas deben empezar con 30
    assert clients[0].cedula.startswith("3099999")
    db.close()
