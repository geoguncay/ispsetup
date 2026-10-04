import os
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
    # Agregar un técnico
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


def _auth(client: TestClient) -> dict:
    login = client.post("/api/auth/login", json={"email": "tecnico@test.com", "password": "tecnicopass123"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_access_points_and_links_crud(client: TestClient):
    h = _auth(client)
    ap1 = client.post("/api/map/access-points", json={"name": "AP Norte", "latitude": -0.1, "longitude": -78.4}, headers=h)
    ap2 = client.post("/api/map/access-points", json={"name": "AP Sur", "latitude": -0.2, "longitude": -78.5}, headers=h)
    assert ap1.status_code == 201 and ap2.status_code == 201
    id1, id2 = ap1.json()["id"], ap2.json()["id"]

    moved = client.put(f"/api/map/access-points/{id1}", json={"latitude": -0.15}, headers=h)
    assert moved.json()["latitude"] == -0.15 and moved.json()["name"] == "AP Norte"

    link = client.post("/api/map/links", json={
        "kind": "ptp", "source_type": "ap", "source_id": id1, "target_type": "ap", "target_id": id2,
    }, headers=h)
    assert link.status_code == 201

    # Duplicado en sentido inverso y auto-enlace se rechazan
    reverse = client.post("/api/map/links", json={
        "kind": "ap", "source_type": "ap", "source_id": id2, "target_type": "ap", "target_id": id1,
    }, headers=h)
    assert reverse.status_code == 400
    loop = client.post("/api/map/links", json={
        "kind": "ap", "source_type": "ap", "source_id": id1, "target_type": "ap", "target_id": id1,
    }, headers=h)
    assert loop.status_code == 400

    assert client.put(f"/api/map/links/{link.json()['id']}", json={"kind": "ap"}, headers=h).json()["kind"] == "ap"

    # Reconectar un extremo
    ap3 = client.post("/api/map/access-points", json={"name": "AP Este", "latitude": -0.3, "longitude": -78.3}, headers=h).json()["id"]
    moved_link = client.put(f"/api/map/links/{link.json()['id']}", json={"target_type": "ap", "target_id": ap3}, headers=h)
    assert moved_link.status_code == 200 and moved_link.json()["target_id"] == ap3 and moved_link.json()["kind"] == "ap"
    assert client.put(f"/api/map/links/{link.json()['id']}", json={"target_type": "ap"}, headers=h).status_code == 400

    # Borrar un AP elimina sus enlaces
    assert client.delete(f"/api/map/access-points/{id1}", headers=h).status_code == 204
    assert client.get("/api/map/links", headers=h).json() == []


def test_create_ptp_with_connection(client: TestClient):
    h = _auth(client)
    base = client.post("/api/map/access-points", json={"name": "Torre", "latitude": 0, "longitude": 0}, headers=h).json()
    res = client.post("/api/map/ptp", json={
        "ap": {"name": "PtP-A", "latitude": 0.1, "longitude": 0.1, "ip": "10.0.0.1"},
        "station": {"name": "PtP-B", "latitude": 0.2, "longitude": 0.2},
        "frequency_mhz": 5800,
        "connect_to": {"type": "ap", "id": base["id"]},
    }, headers=h)
    assert res.status_code == 201
    data = res.json()
    assert data["ap"]["role"] == "ap" and data["station"]["role"] == "station"
    assert data["station"]["frequency_mhz"] == 5800 and data["link"]["kind"] == "ptp"
    # 3 radios en total y 2 enlaces (PtP + conexión a la torre)
    assert len(client.get("/api/map/access-points", headers=h).json()) == 3
    assert len(client.get("/api/map/links", headers=h).json()) == 2

    bad = client.post("/api/map/access-points", json={
        "name": "X", "latitude": 0, "longitude": 0, "connect_to": {"type": "router", "id": base["id"]},
    }, headers=h)
    assert bad.status_code == 404
