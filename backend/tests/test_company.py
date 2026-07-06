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


def test_get_company_creates_default(client: TestClient):
    # Obtener token
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    # Consultar empresa
    response = client.get(
        "/api/company", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Mi ISP"
    assert data["ruc"] == ""


def test_update_company_admin_success(client: TestClient):
    # Obtener token de administrador
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    # Actualizar empresa
    response = client.put(
        "/api/company",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "ISP Quito",
            "ruc": "1792949583001",
            "address": "Av. Amazonas, Quito",
            "phone": "+593999999999",
            "email": "contacto@ispquito.com",
            "website": "https://ispquito.com",
            "logo_url": "https://ispquito.com/logo.png",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "ISP Quito"
    assert data["ruc"] == "1792949583001"
    assert data["address"] == "Av. Amazonas, Quito"
    assert data["logo_url"] == "https://ispquito.com/logo.png"



def test_update_company_tecnico_forbidden(client: TestClient):
    # Obtener token de técnico
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    # Intentar actualizar empresa
    response = client.put(
        "/api/company",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "ISP Hack"},
    )
    assert response.status_code == 403


def test_upload_logo_admin_success(client: TestClient):
    # Obtener token de administrador
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    # Subir logo
    file_data = b"fake-png-data"
    response = client.post(
        "/api/company/logo",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("test.png", file_data, "image/png")}
    )
    assert response.status_code == 200
    data = response.json()
    assert "logo_url" in data
    assert data["logo_url"].startswith("/static/uploads/logo_")
    assert data["logo_url"].endswith(".png")

    # Clean up the created file
    local_path = data["logo_url"].lstrip("/")  # removes leading '/' so it becomes static/uploads/...
    if os.path.exists(local_path):
        os.remove(local_path)


def test_upload_logo_invalid_format(client: TestClient):
    # Obtener token de administrador
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    # Subir logo inválido
    response = client.post(
        "/api/company/logo",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("test.txt", b"plain text", "text/plain")}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Formato de imagen no soportado. Use PNG, JPG, JPEG, WEBP o SVG."


def test_upload_logo_tecnico_forbidden(client: TestClient):
    # Obtener token de técnico
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    # Intentar subir logo
    response = client.post(
        "/api/company/logo",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("test.png", b"fake-png-data", "image/png")}
    )
    assert response.status_code == 403
