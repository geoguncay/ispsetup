from unittest.mock import AsyncMock, MagicMock

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
from app.services.zerotier import zerotier_service
from app.services.zerotier.zerotier_service import (
    ZeroTierError,
    _is_online,
    get_member,
    list_members,
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


def _admin_token(client: TestClient) -> str:
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    return login.json()["access_token"]


# ── Servicio: helpers puros ─────────────────────────────────────────────────

def test_is_online_recent_timestamp():
    import time
    assert _is_online(int(time.time() * 1000) - 5_000) is True


def test_is_online_stale_timestamp():
    import time
    assert _is_online(int(time.time() * 1000) - 10 * 60 * 1000) is False


def test_is_online_missing_timestamp():
    assert _is_online(None) is False


# ── Servicio: llamadas HTTP mockeadas ───────────────────────────────────────

class _FakeConfig:
    zt_network_id = "abcdef1234567890"
    zt_api_token_encrypted = None

    def __init__(self, token_encrypted):
        self.zt_api_token_encrypted = token_encrypted


def test_list_members_maps_fields(monkeypatch):
    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.content = b"[]"
    fake_response.json.return_value = [
        {
            "nodeId": "abc1234567",
            "name": "router-central",
            "physicalAddress": "1.2.3.4/1234",
            "lastOnline": None,
            "config": {
                "authorized": True,
                "ipAssignments": ["10.147.20.5"],
                "vMajor": 1, "vMinor": 12, "vRev": 0,
            },
        }
    ]
    monkeypatch.setattr(zerotier_service.httpx, "request", MagicMock(return_value=fake_response))
    monkeypatch.setattr(zerotier_service, "decrypt_secret", lambda _: "fake-token")

    members = list_members(_FakeConfig("enc-token"))

    assert len(members) == 1
    assert members[0].node_id == "abc1234567"
    assert members[0].authorized is True
    assert members[0].ip_assignments == ["10.147.20.5"]
    assert members[0].version == "1.12.0"
    assert members[0].online is False


def test_get_member_returns_none_on_404(monkeypatch):
    fake_response = MagicMock()
    fake_response.status_code = 404
    fake_response.content = b""
    monkeypatch.setattr(zerotier_service.httpx, "request", MagicMock(return_value=fake_response))
    monkeypatch.setattr(zerotier_service, "decrypt_secret", lambda _: "fake-token")

    assert get_member(_FakeConfig("enc-token"), "abc1234567") is None


def test_get_member_maps_online_node(monkeypatch):
    import time

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.content = b"{}"
    fake_response.json.return_value = {
        "nodeId": "abc1234567",
        "name": "gw-central",
        "lastOnline": int(time.time() * 1000) - 5_000,
        "config": {"authorized": True, "ipAssignments": ["10.147.20.5"]},
    }
    monkeypatch.setattr(zerotier_service.httpx, "request", MagicMock(return_value=fake_response))
    monkeypatch.setattr(zerotier_service, "decrypt_secret", lambda _: "fake-token")

    member = get_member(_FakeConfig("enc-token"), "abc1234567")
    assert member is not None
    assert member.node_id == "abc1234567"
    assert member.online is True


def test_request_raises_on_invalid_token(monkeypatch):
    fake_response = MagicMock()
    fake_response.status_code = 401
    monkeypatch.setattr(zerotier_service.httpx, "request", MagicMock(return_value=fake_response))
    monkeypatch.setattr(zerotier_service, "decrypt_secret", lambda _: "bad-token")

    with pytest.raises(ZeroTierError):
        list_members(_FakeConfig("enc-token"))


# ── API: settings ────────────────────────────────────────────────────────────

def test_get_settings_defaults_unconfigured(client: TestClient):
    token = _admin_token(client)
    response = client.get("/api/zerotier/settings", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()
    assert data["zt_network_id"] is None
    assert data["zt_api_token_set"] is False
    assert data["zt_enabled"] is False


def test_update_settings_stores_encrypted_token(client: TestClient):
    token = _admin_token(client)
    response = client.put(
        "/api/zerotier/settings",
        json={"zt_network_id": "abcdef1234567890", "zt_api_token": "supersecret", "zt_enabled": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["zt_network_id"] == "abcdef1234567890"
    assert data["zt_api_token_set"] is True
    assert data["zt_enabled"] is True

    # El token nunca se expone en texto plano
    assert "supersecret" not in response.text


def test_members_endpoint_requires_configuration(client: TestClient):
    token = _admin_token(client)
    response = client.get("/api/zerotier/members", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 400


def test_no_member_mutation_endpoints_exist(client: TestClient):
    """La autorización de miembros es exclusiva de my.zerotier.com; la API no debe
    exponer forma alguna de autorizar/revocar/renombrar nodos."""
    token = _admin_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/zerotier/members/abc1234567/authorize", headers=headers).status_code == 404
    assert client.post("/api/zerotier/members/abc1234567/deauthorize", headers=headers).status_code == 404
    assert client.patch("/api/zerotier/members/abc1234567", json={}, headers=headers).status_code == 404
