"""
Tests de autenticación — endpoints /auth/* incluyendo /auth/setup.

La clave es usar StaticPool de SQLAlchemy, que garantiza que todos los threads
comparten la misma conexión SQLite en memoria (evita el problema de tablas
vacías cuando FastAPI usa anyio.to_thread.run_sync).
"""
import os
import tempfile
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Importar app primero
from app.main import app
from app.core import database as db_module
from app.core.database import Base
from app.core.deps import get_db
from app.core.security import hash_password
from app.models.user import User  # noqa: F401 — necesario para que Base conozca el modelo

# ── Engine SQLite con StaticPool (misma conexión en todos los threads) ────────
engine_test = create_engine(
    "sqlite://",  # ":memory:" implícito
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
    """Redis mock asíncrono — no requiere servidor real."""
    mock = AsyncMock()
    mock.setex = AsyncMock(return_value=True)
    mock.get = AsyncMock(return_value=None)
    mock.delete = AsyncMock(return_value=True)
    return mock


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    """Crea tablas, inserta usuario de prueba y mockea Redis antes de cada test."""
    # Parchear engine global para que main.py y deps usen el mismo SQLite
    monkeypatch.setattr(db_module, "engine", engine_test)
    monkeypatch.setattr(db_module, "SessionLocal", TestingSessionLocal)

    Base.metadata.create_all(bind=engine_test)

    db = TestingSessionLocal()
    db.add(User(
        name="Test Admin",
        email="admin@test.com",
        hashed_password=hash_password("testpassword123"),
        role="admin",
        active=True,
    ))
    db.commit()
    db.close()

    # Mock de Redis en el módulo auth
    monkeypatch.setattr("app.api.auth.redis_client", make_redis_mock())

    yield

    Base.metadata.drop_all(bind=engine_test)


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── Tests de login ────────────────────────────────────────────────────────────
def test_login_success(client: TestClient):
    response = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "testpassword123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_wrong_password(client: TestClient):
    response = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "wrongpassword"},
    )
    assert response.status_code == 401


def test_login_unknown_email(client: TestClient):
    response = client.post(
        "/api/auth/login",
        json={"email": "noexiste@test.com", "password": "anypassword"},
    )
    assert response.status_code == 401


def test_me_without_token(client: TestClient):
    response = client.get("/api/users/me")
    # Diferentes versiones de FastAPI devuelven 401 o 403
    assert response.status_code in (401, 403)


def test_me_with_token(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "testpassword123"},
    )
    token = login.json()["access_token"]
    response = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.json()["email"] == "admin@test.com"
    assert response.json()["role"] == "admin"


def test_health_endpoint(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# ── Tests de /auth/setup ──────────────────────────────────────────────────────
def test_setup_no_seed_key_configured(client: TestClient, monkeypatch):
    """ADMIN_SEED_KEY no configurada → 501."""
    monkeypatch.setattr("app.api.auth.settings.ADMIN_SEED_KEY", None)
    response = client.post("/api/auth/setup", json={"seed_key": "cualquier"})
    assert response.status_code == 501
    assert "ADMIN_SEED_KEY" in response.json()["detail"]


def test_setup_wrong_key(client: TestClient, monkeypatch):
    """Clave incorrecta → 403."""
    monkeypatch.setattr("app.api.auth.settings.ADMIN_SEED_KEY", "correcta")
    response = client.post("/api/auth/setup", json={"seed_key": "incorrecta"})
    assert response.status_code == 403


def test_setup_idempotent_same_email(client: TestClient, monkeypatch):
    """Email del admin ya existe → created=False, sin error."""
    monkeypatch.setattr("app.api.auth.settings.ADMIN_SEED_KEY", "test-key")
    response = client.post(
        "/api/auth/setup",
        json={"seed_key": "test-key", "email": "admin@test.com"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["created"] is False
    assert "ya existe" in data["message"]


def test_setup_conflict_different_admin_exists(client: TestClient, monkeypatch):
    """Admin activo con otro email → 409 Conflict."""
    monkeypatch.setattr("app.api.auth.settings.ADMIN_SEED_KEY", "test-key")
    response = client.post(
        "/api/auth/setup",
        json={"seed_key": "test-key", "email": "otro@admin.com", "password": "pass1234"},
    )
    assert response.status_code == 409
    assert "administrador activo" in response.json()["detail"]


def test_setup_creates_admin_when_no_admin_exists(monkeypatch):
    """BD vacía (sin admin) → crea el usuario, created=True."""
    engine_empty = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    EmptySession = sessionmaker(autocommit=False, autoflush=False, bind=engine_empty)
    Base.metadata.create_all(bind=engine_empty)

    def empty_db():
        db = EmptySession()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr("app.api.auth.settings.ADMIN_SEED_KEY", "test-key")
    monkeypatch.setattr("app.api.auth.redis_client", make_redis_mock())

    app.dependency_overrides[get_db] = empty_db  # type: ignore
    with TestClient(app) as c:
        response = c.post(
            "/api/auth/setup",
            json={
                "seed_key": "test-key",
                "email": "nuevo@admin.com",
                "password": "securepass123",
                "name": "Nuevo Admin",
            },
        )
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine_empty)

    assert response.status_code == 200
    data = response.json()
    assert data["created"] is True
    assert data["email"] == "nuevo@admin.com"


def test_inactivity_timeout_flow(client: TestClient):
    # 1. Obtener token de administrador
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "testpassword123"},
    )
    token = login.json()["access_token"]

    # 2. Consultar perfil actual y verificar valor por defecto (0)
    response = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    user_data = response.json()
    assert "inactivity_timeout" in user_data
    assert user_data["inactivity_timeout"] == 0

    # 3. Actualizar timeout de inactividad
    user_id = user_data["id"]
    response_update = client.put(
        f"/api/users/{user_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Test Admin Modified",
            "email": "admin@test.com",
            "inactivity_timeout": 15,
        }
    )
    assert response_update.status_code == 200
    assert response_update.json()["inactivity_timeout"] == 15

    # 4. Consultar /auth/me nuevamente y verificar el valor actualizado
    response_me = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response_me.status_code == 200
    assert response_me.json()["inactivity_timeout"] == 15
