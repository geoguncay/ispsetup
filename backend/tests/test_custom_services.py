import pytest
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from unittest.mock import AsyncMock

from app.core import database as db_module
from app.core.database import Base
from app.core.deps import get_db
from app.core.security import hash_password
from app.main import app
from app.models.user import User
from app.models.custom_service import CustomService

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


def test_custom_service_crud_admin(client: TestClient):
    # 1. Login as Admin
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. List (should be empty initially)
    response = client.get("/api/custom-services", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 0

    # 3. Create Custom Service
    response = client.post(
        "/api/custom-services",
        headers=headers,
        json={
            "name": "Alquiler de Router",
            "price": 5.00,
            "description": "Arriendo mensual de router adicional dual band",
            "taxes": 15.0,
            "active": True,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Alquiler de Router"
    assert data["price"] == 5.0
    assert data["taxes"] == 15.0
    service_id = data["id"]

    # 4. Detail
    response = client.get(f"/api/custom-services/{service_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Alquiler de Router"

    # 5. Update Custom Service
    response = client.put(
        f"/api/custom-services/{service_id}",
        headers=headers,
        json={
            "price": 7.50,
            "description": "Arriendo mensual de router - precio actualizado",
        },
    )
    assert response.status_code == 200
    assert response.json()["price"] == 7.5
    assert response.json()["description"] == "Arriendo mensual de router - precio actualizado"

    # 6. Delete Custom Service
    response = client.delete(f"/api/custom-services/{service_id}", headers=headers)
    assert response.status_code == 204

    # 7. Verify deletion
    response = client.get(f"/api/custom-services/{service_id}", headers=headers)
    assert response.status_code == 404


def test_custom_service_permissions_tecnico(client: TestClient):
    # 1. Login as Admin to seed a service
    login_admin = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    admin_token = login_admin.json()["access_token"]
    response = client.post(
        "/api/custom-services",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "name": "Soporte Extra",
            "price": 15.00,
            "description": "Visita tecnica fuera de horario",
            "taxes": 0.0,
            "active": True,
        },
    )
    service_id = response.json()["id"]

    # 2. Login as Tecnico
    login_tecnico = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    tecnico_token = login_tecnico.json()["access_token"]
    headers = {"Authorization": f"Bearer {tecnico_token}"}

    # 3. List (should succeed)
    response = client.get("/api/custom-services", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 1

    # 4. Create (should be forbidden)
    response = client.post(
        "/api/custom-services",
        headers=headers,
        json={
            "name": "Otro servicio",
            "price": 10.00,
        },
    )
    assert response.status_code == 403

    # 5. Update (should be forbidden)
    response = client.put(
        f"/api/custom-services/{service_id}",
        headers=headers,
        json={"price": 20.00},
    )
    assert response.status_code == 403

    # 6. Delete (should be forbidden)
    response = client.delete(f"/api/custom-services/{service_id}", headers=headers)
    assert response.status_code == 403
