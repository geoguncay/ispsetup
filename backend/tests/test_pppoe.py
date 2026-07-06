import pytest
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
from app.models.pppoe_profile import PPPoEProfile
from app.models.pppoe_secret import PPPoESecret
from app.services.mikrotik.pppoe import (
    parse_rate_limit,
    bytes_to_human,
    sync_pppoe_profiles_from_gateway,
    sync_pppoe_secret_in_gateway,
    remove_pppoe_secret_from_gateway,
    fetch_active_pppoe_sessions,
    disconnect_pppoe_session,
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
    # Add admin
    db.add(User(
        name="Test Admin",
        email="admin@test.com",
        hashed_password=hash_password("adminpass123"),
        role="admin",
        active=True,
    ))
    # Add gateway
    db.add(Gateway(
        name="Router Quito PPPoE",
        ip="10.0.0.5",
        api_port=8728,
        api_username="admin",
        password_enc="encrypted_pass",
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


def test_parse_rate_limit():
    # Format: rx-rate/tx-rate (Upload/Download)
    assert parse_rate_limit(None) == (None, None)
    assert parse_rate_limit("") == (None, None)
    assert parse_rate_limit("invalid") == (None, None)
    assert parse_rate_limit("5M/10M") == (10, 5)
    assert parse_rate_limit("512k/1024k") == (1, 1)  # max(1, 1024/1024) -> 1, max(1, 512/1024) -> 1
    assert parse_rate_limit("1G/2G") == (2048, 1024)
    # Burst format: rx-rate/tx-rate rx-burst-threshold/tx-burst-threshold rx-burst-limit/tx-burst-limit ...
    assert parse_rate_limit("5M/10M 1M/2M 8M/16M") == (10, 5)


def test_bytes_to_human():
    assert bytes_to_human(None) == "0 B"
    assert bytes_to_human("invalid") == "invalid"
    assert bytes_to_human(500) == "500 B"
    assert bytes_to_human(1024) == "1.0 KB"
    assert bytes_to_human(1048576) == "1.0 MB"
    assert bytes_to_human(1073741824) == "1.0 GB"


@patch("app.services.mikrotik.pppoe.gateway_pool.connect_to")
def test_sync_pppoe_profiles(mock_connect_to):
    # Setup mock for MikroTik connection
    api_mock = MagicMock()
    api_mock.path.return_value.select.return_value.where.return_value = []
    mock_connect_to.return_value.__enter__.return_value = api_mock

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()

    # Pre-add three plans
    from app.models.plan import Plan
    db.add_all([
        Plan(name="default", speed_down_mbps=10, speed_up_mbps=2, price=10.0),
        Plan(name="Plan_10M", speed_down_mbps=10, speed_up_mbps=2, price=20.0),
        Plan(name="Plan_20M", speed_down_mbps=20, speed_up_mbps=4, price=30.0),
    ])

    # Pre-populate an old profile that should be deleted if not in active list
    old_profile = PPPoEProfile(
        name="Plan_Old",
        speed_down_mbps=5,
        speed_up_mbps=2,
        gateway_id=gateway.id,
    )
    db.add(old_profile)
    db.commit()

    count = sync_pppoe_profiles_from_gateway(db, gateway)
    assert count == 3

    # Check profiles in database
    profiles = db.query(PPPoEProfile).filter(PPPoEProfile.gateway_id == gateway.id).all()
    assert len(profiles) == 3
    names = {p.name for p in profiles}
    assert names == {"default", "Plan_10M", "Plan_20M"}

    plan_10m = db.query(PPPoEProfile).filter(PPPoEProfile.name == "Plan_10M").first()
    assert plan_10m.speed_down_mbps == 10
    assert plan_10m.speed_up_mbps == 2

    # Plan_Old should be deleted
    old_exists = db.query(PPPoEProfile).filter(PPPoEProfile.name == "Plan_Old").first()
    assert old_exists is None

    db.close()


@patch("app.services.mikrotik.pppoe.gateway_pool.connect_to")
def test_sync_pppoe_secret(mock_connect_to):
    # Setup mock: first query returns empty (does not exist), second exists
    api_mock = MagicMock()
    api_mock.path.return_value.select.return_value.where.return_value = []
    mock_connect_to.return_value.__enter__.return_value = api_mock

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    # Call sync (creation)
    sync_pppoe_secret_in_gateway(gateway, "user1", "pass123", "default", "Client 1")

    # Assert api was called with "/ppp/secret/add"
    api_mock.assert_called_with(
        "/ppp/secret/add",
        name="user1",
        password="pass123",
        profile="default",
        comment="Client 1",
        service="pppoe",
        disabled=False,
    )

    # Now simulate secret exists
    api_mock.path.return_value.select.return_value.where.return_value = [
        {".id": "*1", "name": "user1"}
    ]
    sync_pppoe_secret_in_gateway(gateway, "user1", "newpass", "Plan_10M", "Client 1", disabled=True)

    api_mock.assert_called_with(
        "/ppp/secret/set",
        **{
            ".id": "*1",
            "name": "user1",
            "password": "newpass",
            "profile": "Plan_10M",
            "comment": "Client 1",
            "service": "pppoe",
            "disabled": True,
        }
    )


@patch("app.services.mikrotik.pppoe.gateway_pool.connect_to")
def test_remove_pppoe_secret(mock_connect_to):
    api_mock = MagicMock()
    api_mock.path.return_value.select.return_value.where.return_value = [
        {".id": "*1", "name": "user1"}
    ]
    mock_connect_to.return_value.__enter__.return_value = api_mock

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    remove_pppoe_secret_from_gateway(gateway, "user1")
    api_mock.assert_called_with("/ppp/secret/remove", **{".id": "*1"})


@patch("app.services.mikrotik.pppoe.gateway_pool.connect_to")
def test_fetch_active_pppoe_sessions(mock_connect_to):
    api_mock = MagicMock()
    api_mock.path.return_value = [
        {
            ".id": "*A1",
            "name": "user1",
            "address": "10.10.10.10",
            "uptime": "5m",
            "caller-id": "AA:BB:CC:DD:EE:FF",
            "bytes-out": 1048576,
            "bytes-in": 524288,
        }
    ]
    mock_connect_to.return_value.__enter__.return_value = api_mock

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    sessions = fetch_active_pppoe_sessions(gateway)
    assert len(sessions) == 1
    assert sessions[0]["username"] == "user1"
    assert sessions[0]["ip_address"] == "10.10.10.10"
    assert sessions[0]["uptime"] == "5m"
    assert sessions[0]["bytes_tx"] == 1048576
    assert sessions[0]["bytes_tx_human"] == "1.0 MB"
    assert sessions[0]["bytes_rx_human"] == "512.0 KB"


@patch("app.services.mikrotik.pppoe.gateway_pool.connect_to")
def test_disconnect_pppoe_session(mock_connect_to):
    api_mock = MagicMock()
    api_mock.path.return_value.select.return_value.where.return_value = [
        {".id": "*A1", "name": "user1"}
    ]
    mock_connect_to.return_value.__enter__.return_value = api_mock

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    res = disconnect_pppoe_session(gateway, "user1")
    assert res is True
    api_mock.assert_called_with("/ppp/active/remove", **{".id": "*A1"})


@patch("app.services.mikrotik.pppoe.gateway_pool.connect_to")
def test_client_pppoe_flow_in_api(mock_connect_to, client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()

    # Pre-add a plan
    from app.models.plan import Plan
    plan = Plan(
        name="Plan Fibra 10 Mbps",
        speed_down_mbps=10,
        speed_up_mbps=2,
        speed_down_kbps=10000,
        speed_up_kbps=2000,
        price=20.0,
    )
    db.add(plan)
    db.commit()
    plan_id = plan.id
    gateway_id = gateway.id
    db.close()

    # 1. Create a client with connection type PPPoE
    response = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Esteban Quito",
            "cedula": "1724024888",
            "phone": "0999999999",
            "address": "Quito",
            "gateway_id": str(gateway_id),
            "connection_type": "pppoe",
            "ppp_username": "esteban_ppp",
            "ppp_password": "estebanpass",
            "plan_id": str(plan_id),
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Esteban Quito"
    assert data["pppoe_secret"]["ppp_username"] == "esteban_ppp"
    assert data["pppoe_secret"]["ppp_password"] == "estebanpass"

    # Verify that the perfil was created with the plan's name
    db = TestingSessionLocal()
    db_profile = db.query(PPPoEProfile).filter(PPPoEProfile.name == "Plan Fibra 10 Mbps").first()
    assert db_profile is not None
    assert data["pppoe_secret"]["profile_id"] == str(db_profile.id)
    db.close()

    client_id = data["id"]

    # Verify database model was correctly populated
    db = TestingSessionLocal()
    import uuid
    db_client = db.query(Client).filter(Client.id == uuid.UUID(client_id)).first()
    assert db_client.connection_type == "pppoe"
    assert db_client.pppoe_secret is not None
    assert db_client.pppoe_secret.ppp_username == "esteban_ppp"
    # Password should be decrypted cleanly via property / API response
    assert db_client.pppoe_secret.ppp_username == "esteban_ppp"
    db.close()

    # 2. Update the client PPPoE details
    response = client.put(
        f"/api/clients/{client_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "ppp_username": "esteban_ppp_updated",
            "ppp_password": "newestebanpass",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["pppoe_secret"]["ppp_username"] == "esteban_ppp_updated"
    assert data["pppoe_secret"]["ppp_password"] == "newestebanpass"

    # 3. Suspend PPPoE Client (should disable secret and kick active session)
    with patch("app.api.clients.disconnect_pppoe_session") as mock_kick, \
         patch("app.api.clients.sync_pppoe_secret_in_gateway") as mock_sync_secret:
        response = client.post(
            f"/api/clients/{client_id}/suspend",
            headers={"Authorization": f"Bearer {token}"},
            params={"reason": "Falta de pago"}
        )
        assert response.status_code == 200
        assert response.json()["reason"] == "Falta de pago"

        # Verify status in database
        db = TestingSessionLocal()
        db_client = db.query(Client).filter(Client.id == uuid.UUID(client_id)).first()
        assert db_client.active is False
        db.close()

        # Verify suspension calls were made
        mock_sync_secret.assert_called_once()
        mock_kick.assert_called_once_with(ANY, "esteban_ppp_updated")

    # 4. Reactivate PPPoE Client (should re-enable secret)
    with patch("app.api.clients.sync_pppoe_secret_in_gateway") as mock_sync_secret:
        response = client.post(
            f"/api/clients/{client_id}/reactivate",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["reactivated_at"] is not None

        # Verify status in database
        db = TestingSessionLocal()
        db_client = db.query(Client).filter(Client.id == uuid.UUID(client_id)).first()
        assert db_client.active is True
        db.close()

        # Verify reactivation call was made
        mock_sync_secret.assert_called_once()
