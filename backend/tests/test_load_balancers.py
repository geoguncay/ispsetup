"""
Tests CRUD y de prueba de conexión para balanceadores de carga.
"""
import uuid
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

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
from app.services.router.router_pool import RouterConnectionError

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
    monkeypatch.setattr("app.api.load_balancers_api.redis_client", make_redis_mock())
    monkeypatch.setattr("app.services.load_balancer.health.redis_client", make_redis_mock())

    Base.metadata.create_all(bind=engine_test)

    db = TestingSessionLocal()
    db.add(User(
        name="Test Admin",
        email="admin@test.com",
        hashed_password=hash_password("adminpass123"),
        role="admin",
        active=True,
    ))
    db.add(User(
        name="Test Tecnico",
        email="tecnico@test.com",
        hashed_password=hash_password("tecnicopass123"),
        role="technician",
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


def _admin_token(client: TestClient) -> str:
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    return login.json()["access_token"]


def test_create_load_balancer(client: TestClient):
    token = _admin_token(client)
    response = client.post(
        "/api/load-balancers",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "LB Matriz",
            "ip": "10.0.0.50",
            "api_port": 8728,
            "api_username": "admin",
            "password_api": "secret123",
            "hw_model": "CCR2004-1G-12S+2XS",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "LB Matriz"
    assert body["ip"] == "10.0.0.50"
    assert "password_api" not in body
    assert "password_enc" not in body

    db = TestingSessionLocal()
    stored = db.query(LoadBalancer).filter(LoadBalancer.name == "LB Matriz").first()
    db.close()
    assert stored is not None
    assert stored.password_enc != "secret123"


def test_create_load_balancer_with_zerotier_node(client: TestClient):
    token = _admin_token(client)
    response = client.post(
        "/api/load-balancers",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "LB ZeroTier",
            "ip": "10.147.20.10",
            "api_username": "admin",
            "password_api": "secret123",
            "zerotier_node_id": "abc1234567",
        },
    )
    assert response.status_code == 201
    assert response.json()["zerotier_node_id"] == "abc1234567"


def test_technician_cannot_create_load_balancer(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]
    response = client.post(
        "/api/load-balancers",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "LB Matriz",
            "ip": "10.0.0.50",
            "api_username": "admin",
            "password_api": "secret123",
        },
    )
    assert response.status_code == 403


def test_list_and_get_load_balancer(client: TestClient):
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/load-balancers",
        headers=headers,
        json={
            "name": "LB Sur",
            "ip": "10.0.0.51",
            "api_username": "admin",
            "password_api": "secret123",
        },
    ).json()

    listing = client.get("/api/load-balancers", headers=headers)
    assert listing.status_code == 200
    assert any(item["id"] == created["id"] for item in listing.json())

    detail = client.get(f"/api/load-balancers/{created['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["name"] == "LB Sur"
    # Sin health-check todavía corrido, el estado por defecto es "unknown" (no un error).
    assert detail.json()["status"] == "unknown"
    listed_item = next(item for item in listing.json() if item["id"] == created["id"])
    assert listed_item["status"] == "unknown"


def test_live_status_endpoint(client: TestClient):
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/load-balancers",
        headers=headers,
        json={
            "name": "LB Estado",
            "ip": "10.0.0.57",
            "api_username": "admin",
            "password_api": "secret123",
        },
    ).json()

    @contextmanager
    def _fake_connect(_device):
        def _api_call(_command):
            return [{"version": "7.15", "uptime": "2d3h"}]
        yield _api_call

    with patch("app.services.load_balancer.health.router_pool.connect_to", _fake_connect):
        response = client.get(f"/api/load-balancers/{created['id']}/status", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "online"
    assert body["ros_version"] == "7.15"
    assert body["uptime"] == "2d3h"


def test_update_load_balancer(client: TestClient):
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/load-balancers",
        headers=headers,
        json={
            "name": "LB Norte",
            "ip": "10.0.0.52",
            "api_username": "admin",
            "password_api": "secret123",
        },
    ).json()

    updated = client.put(
        f"/api/load-balancers/{created['id']}",
        headers=headers,
        json={"name": "LB Norte Renombrado", "notes": "actualizado"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "LB Norte Renombrado"
    assert updated.json()["notes"] == "actualizado"


def test_delete_load_balancer_soft_deletes(client: TestClient):
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/load-balancers",
        headers=headers,
        json={
            "name": "LB Temporal",
            "ip": "10.0.0.53",
            "api_username": "admin",
            "password_api": "secret123",
        },
    ).json()

    deleted = client.delete(f"/api/load-balancers/{created['id']}", headers=headers)
    assert deleted.status_code == 204

    detail = client.get(f"/api/load-balancers/{created['id']}", headers=headers)
    assert detail.status_code == 404

    db = TestingSessionLocal()
    stored = db.get(LoadBalancer, uuid.UUID(created["id"]))
    db.close()
    assert stored is not None
    assert stored.active is False


def test_test_connection_success(client: TestClient):
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/load-balancers",
        headers=headers,
        json={
            "name": "LB Conexion",
            "ip": "10.0.0.54",
            "api_username": "admin",
            "password_api": "secret123",
        },
    ).json()

    @contextmanager
    def _fake_connect(_device):
        def _api_call(_command):
            return [{"version": "7.15", "uptime": "3d2h"}]
        yield _api_call

    with patch("app.api.load_balancers_api.router_pool.connect_to", _fake_connect):
        response = client.post(
            f"/api/load-balancers/{created['id']}/test-connection",
            headers=headers,
        )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["ros_version"] == "7.15"


def test_test_connection_failure(client: TestClient):
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    created = client.post(
        "/api/load-balancers",
        headers=headers,
        json={
            "name": "LB Falla",
            "ip": "10.0.0.55",
            "api_username": "admin",
            "password_api": "secret123",
        },
    ).json()

    @contextmanager
    def _fake_connect(_device):
        raise RouterConnectionError("timeout")
        yield  # pragma: no cover

    with patch("app.api.load_balancers_api.router_pool.connect_to", _fake_connect):
        response = client.post(
            f"/api/load-balancers/{created['id']}/test-connection",
            headers=headers,
        )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert "timeout" in body["error"]


def test_unsaved_test_connection_requires_password(client: TestClient):
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post(
        "/api/load-balancers/test-connection",
        headers=headers,
        json={"ip": "10.0.0.56", "api_username": "admin"},
    )
    assert response.status_code == 400
