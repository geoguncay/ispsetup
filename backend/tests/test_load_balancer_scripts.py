"""
Tests de configuración de balanceo, aplicación de plantillas e historial —
mockeando la conexión RouterOS. La ejecución de scripts personalizados fue
retirada de la plataforma (solo por Winbox), así que no hay tests para eso.
"""
from contextlib import contextmanager
from unittest.mock import AsyncMock

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
from app.services.router.router_pool import router_pool

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
    db.add(User(
        name="Test Admin",
        email="admin@test.com",
        hashed_password=hash_password("adminpass123"),
        role="admin",
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


def _create_load_balancer(client: TestClient, headers: dict) -> dict:
    response = client.post(
        "/api/load-balancers",
        headers=headers,
        json={
            "name": "LB Scripts",
            "ip": "10.0.0.60",
            "api_username": "admin",
            "password_api": "secret123",
        },
    )
    assert response.status_code == 201
    return response.json()


@contextmanager
def _fake_connect_success(_device):
    def _api_call(_path, **_kwargs):
        return []
    yield _api_call


@contextmanager
def _fake_connect_failure(_device):
    raise Exception("no route to host")
    yield  # pragma: no cover


def test_update_balancing_config(client: TestClient):
    headers = _admin_headers(client)
    lb = _create_load_balancer(client, headers)

    response = client.put(
        f"/api/load-balancers/{lb['id']}/balancing",
        headers=headers,
        json={
            "algorithm": "pcc",
            "wan_links": [
                {"interface": "ether1", "gateway": "192.168.1.1", "weight": 2},
                {"interface": "ether2", "gateway": "192.168.2.1", "weight": 1},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["algorithm"] == "pcc"
    assert len(body["wan_links"]) == 2
    assert body["wan_links"][0]["interface"] == "ether1"


def test_balancing_config_allows_saving_a_single_link(client: TestClient):
    """
    La UI agrega enlaces WAN de a uno desde un modal, así que guardar la
    configuración con menos de 2 enlaces debe funcionar — el mínimo de 2 se
    exige recién al aplicar la plantilla, no al guardar.
    """
    headers = _admin_headers(client)
    lb = _create_load_balancer(client, headers)

    response = client.put(
        f"/api/load-balancers/{lb['id']}/balancing",
        headers=headers,
        json={"algorithm": "pcc", "wan_links": [{"interface": "ether1", "gateway": "192.168.1.1"}]},
    )
    assert response.status_code == 200
    assert len(response.json()["wan_links"]) == 1


def test_balancing_config_allows_clearing_all_links(client: TestClient):
    headers = _admin_headers(client)
    lb = _create_load_balancer(client, headers)

    response = client.put(
        f"/api/load-balancers/{lb['id']}/balancing",
        headers=headers,
        json={"algorithm": "pcc", "wan_links": []},
    )
    assert response.status_code == 200
    assert response.json()["wan_links"] == []


def test_apply_template_requires_wan_links_configured(client: TestClient):
    headers = _admin_headers(client)
    lb = _create_load_balancer(client, headers)

    response = client.post(f"/api/load-balancers/{lb['id']}/apply-template", headers=headers)
    assert response.status_code == 409


def test_apply_template_requires_at_least_two_links(client: TestClient):
    headers = _admin_headers(client)
    lb = _create_load_balancer(client, headers)
    client.put(
        f"/api/load-balancers/{lb['id']}/balancing",
        headers=headers,
        json={"algorithm": "pcc", "wan_links": [{"interface": "ether1", "gateway": "192.168.1.1"}]},
    )

    response = client.post(f"/api/load-balancers/{lb['id']}/apply-template", headers=headers)
    assert response.status_code == 409


def test_apply_template_success_records_history(client: TestClient, monkeypatch):
    headers = _admin_headers(client)
    lb = _create_load_balancer(client, headers)
    client.put(
        f"/api/load-balancers/{lb['id']}/balancing",
        headers=headers,
        json={
            "algorithm": "failover",
            "wan_links": [
                {"interface": "ether1", "gateway": "192.168.1.1", "priority": 0},
                {"interface": "ether2", "gateway": "192.168.2.1", "priority": 1},
            ],
        },
    )

    monkeypatch.setattr(router_pool, "connect_to", _fake_connect_success)

    response = client.post(f"/api/load-balancers/{lb['id']}/apply-template", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert "FAILOVER" in body["source"]

    history = client.get(f"/api/load-balancers/{lb['id']}/script-runs", headers=headers)
    assert history.status_code == 200
    runs = history.json()
    assert len(runs) == 1
    assert runs[0]["origin"] == "template"
    assert runs[0]["success"] is True
    assert runs[0]["algorithm"] == "failover"


def test_apply_template_failure_records_history(client: TestClient, monkeypatch):
    headers = _admin_headers(client)
    lb = _create_load_balancer(client, headers)
    client.put(
        f"/api/load-balancers/{lb['id']}/balancing",
        headers=headers,
        json={
            "algorithm": "pcc",
            "wan_links": [
                {"interface": "ether1", "gateway": "192.168.1.1"},
                {"interface": "ether2", "gateway": "192.168.2.1"},
            ],
        },
    )

    monkeypatch.setattr(router_pool, "connect_to", _fake_connect_failure)

    response = client.post(f"/api/load-balancers/{lb['id']}/apply-template", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert "no route to host" in body["output"]

    history = client.get(f"/api/load-balancers/{lb['id']}/script-runs", headers=headers)
    assert history.json()[0]["success"] is False
