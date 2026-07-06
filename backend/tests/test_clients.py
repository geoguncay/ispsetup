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
from app.models.plan import Plan
from app.models.gateway import Gateway
from app.models.client import Client
from app.models.client_plan import ClientPlan

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
    # Agregar un gateway
    db.add(Gateway(
        name="Router Quito Central",
        ip="10.0.0.1",
        api_port=8728,
        api_username="admin",
        password_enc="encrypted_pass",
        active=True,
    ))
    # Agregar un plan
    db.add(Plan(
        name="Plan Fibra 50 Mbps",
        speed_down_mbps=50,
        speed_up_mbps=25,
        speed_down_kbps=50000,
        speed_up_kbps=25000,
        price=22.40,
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


@pytest.fixture(autouse=True)
def mock_router_services():
    with patch("app.api.clients.sync_ip_in_address_list"), \
         patch("app.api.clients.remove_ip_from_address_list"), \
         patch("app.api.clients.sync_client_queue"), \
         patch("app.api.clients.remove_client_queue"), \
         patch("app.api.clients.toggle_client_queue"):
        yield


def test_create_client_invalid_cedula(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    # Obtener gateway
    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    # Cédula inválida (largo de 10 pero algoritmo incorrecto)
    response = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Juan Perez",
            "cedula": "1724024883",  # Inválido (10 dígitos pero verificador incorrecto)
            "phone": "0999999999",
            "address": "Sector La Mariscal, Quito",
            "gateway_id": str(gateway.id),
            "connection_type": "static",
            "ip": "192.168.10.10",
        },
    )
    assert response.status_code == 422
    assert "cédula o RUC" in response.text


def test_create_client_valid_cedula_no_plan(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    # Cédula ecuatoriana válida: 1724024888
    response = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Juan Perez",
            "cedula": "1724024888",
            "phone": "0999999999",
            "address": "Sector La Mariscal, Quito",
            "gateway_id": str(gateway.id),
            "connection_type": "static",
            "ip": "192.168.10.10",
            "latitude": -0.180653,
            "longitude": -78.467834,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Juan Perez"
    assert data["cedula"] == "1724024888"
    assert data["plan_activo"] is None


def test_create_client_with_initial_plan(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()
    db.close()

    response = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Maria Gomez",
            "cedula": "0926079971",  # Cédula válida
            "phone": "0988888888",
            "address": "Av. Carlos Julio Arosemena, Guayaquil",
            "gateway_id": str(gateway.id),
            "plan_id": str(plan.id),
            "connection_type": "static",
            "ip": "192.168.10.10",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Maria Gomez"
    assert data["plan_activo"]["id"] == str(plan.id)
    assert data["plan_activo"]["name"] == "Plan Fibra 50 Mbps"


def test_list_clients_and_filtering(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()

    # Agregar dos clientes con datos válidos
    c1 = Client(name="Andres Lopez", cedula="1724024888", phone="0999999999", address="Quito Central", gateway_id=gateway.id)
    c2 = Client(name="Sofia Velez", cedula="0926079971", phone="0988888888", address="Guayaquil Norte", gateway_id=gateway.id)
    db.add(c1)
    db.add(c2)
    db.flush()

    db.add(ClientPlan(cliente_id=c1.id, plan_id=plan.id, estado="activo"))
    db.commit()
    plan_id = plan.id
    db.close()

    # 1. Listar todos
    response = client.get(
        "/api/clients", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2

    # 2. Filtrar por búsqueda
    response = client.get(
        "/api/clients?search=Sofia", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["name"] == "Sofia Velez"

    # 3. Filtrar por plan_id
    response = client.get(
        f"/api/clients?plan_id={plan_id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["name"] == "Andres Lopez"


def test_list_clients_sorting(client: TestClient):
    from datetime import datetime, timedelta
    import uuid
    from app.models.static_ip import StaticIP
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    r1 = db.query(Gateway).first()
    plan_fibra = db.query(Plan).first()

    # Create a second gateway
    r2 = Gateway(
        name="Router Guayaquil",
        ip="10.0.0.2",
        api_port=8728,
        api_username="admin",
        password_enc="encrypted_pass",
        active=True,
    )
    db.add(r2)

    plan_premium = Plan(
        name="Plan Premium 100 Mbps",
        speed_down_mbps=100,
        speed_up_mbps=50,
        speed_down_kbps=100000,
        speed_up_kbps=50000,
        price=40.0,
    )
    db.add(plan_premium)
    db.flush()

    # Create 3 clients with different details
    # Bernardo: pppoe, inactive, r1, no plan, no ip
    c1 = Client(
        id=uuid.UUID("30000000-0000-0000-0000-000000000000"),
        name="Bernardo",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=r1.id,
        connection_type="pppoe",
        active=False,
        email="bernardo@test.com",
        created_at=datetime.fromisoformat("2025-01-01T12:00:00")
    )
    # Carlos: static, active with scheduled_suspension, r2, plan_premium, ip=10.0.0.20
    c2 = Client(
        id=uuid.UUID("10000000-0000-0000-0000-000000000000"),
        name="Carlos",
        cedula="0926079971",
        phone="0988888888",
        address="Guayaquil",
        gateway_id=r2.id,
        connection_type="static",
        active=True,
        scheduled_suspension=datetime.now() + timedelta(days=5),
        email="carlos@test.com",
        created_at=datetime.fromisoformat("2025-01-02T12:00:00")
    )
    # Andres: static, active, r1, plan_fibra, ip=10.0.0.10
    c3 = Client(
        id=uuid.UUID("20000000-0000-0000-0000-000000000000"),
        name="Andres",
        cedula="1790011674001",
        phone="0977777777",
        address="Cuenca",
        gateway_id=r1.id,
        connection_type="static",
        active=True,
        email="andres@test.com",
        created_at=datetime.fromisoformat("2025-01-03T12:00:00")
    )
    db.add_all([c1, c2, c3])
    db.flush()

    # Add active plans
    db.add(ClientPlan(cliente_id=c2.id, plan_id=plan_premium.id, estado="activo"))
    db.add(ClientPlan(cliente_id=c3.id, plan_id=plan_fibra.id, estado="activo"))

    # Add static IPs
    db.add(StaticIP(client_id=c2.id, ip="10.0.0.20", gateway_id=r2.id))
    db.add(StaticIP(client_id=c3.id, ip="10.0.0.10", gateway_id=r1.id))

    db.commit()
    db.close()

    # 1. Sort by name ascending (Andres, Bernardo, Carlos)
    resp = client.get(
        "/api/clients?sort_by=name&sort_dir=asc",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Andres", "Bernardo", "Carlos"]

    # 2. Sort by name descending (Carlos, Bernardo, Andres)
    resp = client.get(
        "/api/clients?sort_by=name&sort_dir=desc",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Carlos", "Bernardo", "Andres"]

    # 3. Sort by created_at ascending (Bernardo, Carlos, Andres)
    resp = client.get(
        "/api/clients?sort_by=created_at&sort_dir=asc",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Bernardo", "Carlos", "Andres"]

    # 4. Sort by connection_type ascending (Bernardo/pppoe, Andres/static, Carlos/static)
    resp = client.get(
        "/api/clients?sort_by=connection_type&sort_dir=asc",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["items"]]
    assert names[0] == "Bernardo"

    # 5. Sort by active (Andres/activo sin aplazamiento/1, Carlos/activo con suspensión programada/2, Bernardo/inactivo/4)
    resp = client.get(
        "/api/clients?sort_by=active&sort_dir=asc",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Andres", "Carlos", "Bernardo"]

    # 6. Sort by ip descending (Carlos/10.0.0.20, Andres/10.0.0.10, Bernardo/Null)
    resp = client.get(
        "/api/clients?sort_by=ip&sort_dir=desc",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Carlos", "Andres", "Bernardo"]

    # 7. Sort by gateway ascending (Carlos/Router Guayaquil, Bernardo/Router Quito Central, Andres/Router Quito Central)
    resp = client.get(
        "/api/clients?sort_by=gateway&sort_dir=asc",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["items"]]
    assert names[0] == "Carlos"

    # 8. Sort by plan ascending (Bernardo/Null, Andres/Plan Fibra 50 Mbps, Carlos/Plan Premium 100 Mbps)
    resp = client.get(
        "/api/clients?sort_by=plan&sort_dir=asc",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Bernardo", "Andres", "Carlos"]


def test_assign_plan_history(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan_a = db.query(Plan).first()

    plan_b = Plan(
        name="Plan Premium 100 Mbps",
        speed_down_mbps=100,
        speed_up_mbps=50,
        speed_down_kbps=100000,
        speed_up_kbps=50000,
        price=40.0,
    )
    db.add(plan_b)

    c = Client(name="Carlos Ruiz", cedula="1724024888", phone="0999999999", address="Quito Central", gateway_id=gateway.id)
    db.add(c)
    db.flush()

    db.add(ClientPlan(cliente_id=c.id, plan_id=plan_a.id, estado="activo"))
    db.commit()

    client_id = c.id
    plan_b_id = plan_b.id
    plan_a_id = plan_a.id
    db.close()

    # Asignar nuevo plan
    response = client.post(
        f"/api/clients/{client_id}/assign-plan?plan_id={plan_b_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    # Verificar historial
    history_resp = client.get(
        f"/api/clients/{client_id}/plans",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert history_resp.status_code == 200
    history = history_resp.json()
    assert len(history) == 2
    # El plan más nuevo debe ser el activo
    assert history[0]["plan_id"] == str(plan_b_id)
    assert history[0]["estado"] == "activo"
    assert history[1]["plan_id"] == str(plan_a_id)
    assert history[1]["estado"] == "cancelado"


def test_update_client_cedula_and_email(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    # Create client with email
    response = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Test Email Client",
            "cedula": "1724024888",
            "phone": "0999999999",
            "address": "Quito",
            "gateway_id": str(gateway.id),
            "connection_type": "static",
            "ip": "192.168.10.10",
            "email": "test@client.com"
        },
    )
    assert response.status_code == 201
    c_id = response.json()["id"]
    assert response.json()["email"] == "test@client.com"

    # Update client: change cedula and email
    update_resp = client.put(
        f"/api/clients/{c_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "cedula": "0926079971",  # Valid new cedula
            "email": "updated@client.com"
        }
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["cedula"] == "0926079971"
    assert data["email"] == "updated@client.com"


def test_create_client_valid_ruc(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    # 1. RUC Persona Natural (1724024888001)
    resp1 = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Natural RUC Client",
            "cedula": "1724024888001",
            "phone": "0999999999",
            "address": "Quito",
            "gateway_id": str(gateway.id),
            "connection_type": "static",
            "ip": "192.168.10.10",
        },
    )
    assert resp1.status_code == 201
    assert resp1.json()["cedula"] == "1724024888001"

    # 2. RUC Sociedad Privada (1790011674001)
    resp2 = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Juridica RUC Client",
            "cedula": "1790011674001",
            "phone": "0999999999",
            "address": "Quito",
            "gateway_id": str(gateway.id),
            "connection_type": "static",
            "ip": "192.168.10.11",
        },
    )
    assert resp2.status_code == 201
    assert resp2.json()["cedula"] == "1790011674001"

    # 3. RUC Entidad Pública (1760001550001)
    resp3 = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Publica RUC Client",
            "cedula": "1760001550001",
            "phone": "0999999999",
            "address": "Quito",
            "gateway_id": str(gateway.id),
            "connection_type": "static",
            "ip": "192.168.10.12",
        },
    )
    assert resp3.status_code == 201
    assert resp3.json()["cedula"] == "1760001550001"


def test_create_client_invalid_ruc(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    # RUC Inválido (13 dígitos pero verificador incorrecto)
    response = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Invalid RUC Client",
            "cedula": "1790011675001",  # Inválido (dígito verificador incorrecto)
            "phone": "0999999999",
            "address": "Quito",
            "gateway_id": str(gateway.id),
            "connection_type": "static",
            "ip": "192.168.10.10",
        },
    )
    assert response.status_code == 422
    assert "cédula o RUC" in response.text


def test_create_and_update_client_custom_created_at(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    db.close()

    # 1. Crear cliente con created_at específica
    custom_date = "2025-01-15T12:00:00"
    response = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Client With Custom Date",
            "cedula": "1724024888",
            "phone": "0999999999",
            "address": "Quito",
            "gateway_id": str(gateway.id),
            "connection_type": "static",
            "ip": "192.168.10.10",
            "created_at": custom_date,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert "2025-01-15" in data["created_at"]
    client_id = data["id"]

    # 2. Actualizar created_at a otra fecha
    new_custom_date = "2024-12-25T10:30:00"
    update_response = client.put(
        f"/api/clients/{client_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "created_at": new_custom_date,
        },
    )
    assert update_response.status_code == 200
    update_data = update_response.json()
    assert "2024-12-25" in update_data["created_at"]


def test_client_site_filtering(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "tecnico@test.com", "password": "tecnicopass123"},
    )
    token = login.json()["access_token"]

    db = TestingSessionLocal()
    from app.models.site import Site
    site1 = Site(name="Site A")
    site2 = Site(name="Site B")
    db.add(site1)
    db.add(site2)
    db.commit()

    gateway1 = Gateway(
        name="Router Site A",
        ip="10.0.0.10",
        api_port=8728,
        api_username="admin",
        password_enc="encrypted_pass",
        active=True,
        site_id=site1.id,
    )
    gateway2 = Gateway(
        name="Router Site B",
        ip="10.0.0.20",
        api_port=8728,
        api_username="admin",
        password_enc="encrypted_pass",
        active=True,
        site_id=site2.id,
    )
    db.add(gateway1)
    db.add(gateway2)
    db.commit()

    # Cliente en Site A
    response_a = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Client Site A",
            "cedula": "1724024888",
            "phone": "0999999999",
            "address": "Quito A",
            "gateway_id": str(gateway1.id),
            "connection_type": "static",
            "ip": "192.168.10.10",
        },
    )
    assert response_a.status_code == 201

    # Cliente en Site B
    response_b = client.post(
        "/api/clients",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Client Site B",
            "cedula": "0926079971",
            "phone": "0988888888",
            "address": "Guayaquil B",
            "gateway_id": str(gateway2.id),
            "connection_type": "static",
            "ip": "192.168.10.20",
        },
    )
    assert response_b.status_code == 201

    # Consultar clientes filtrando por Site A
    response_filter_a = client.get(
        f"/api/clients?site_id={site1.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response_filter_a.status_code == 200
    data_a = response_filter_a.json()
    assert data_a["total"] == 1
    assert data_a["items"][0]["name"] == "Client Site A"
    assert data_a["items"][0]["site_name"] == "Site A"
    assert data_a["items"][0]["site_id"] == str(site1.id)

    # Consultar clientes filtrando por Site B
    response_filter_b = client.get(
        f"/api/clients?site_id={site2.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response_filter_b.status_code == 200
    data_b = response_filter_b.json()
    assert data_b["total"] == 1
    assert data_b["items"][0]["name"] == "Client Site B"
    assert data_b["items"][0]["site_name"] == "Site B"
    assert data_b["items"][0]["site_id"] == str(site2.id)

    db.close()