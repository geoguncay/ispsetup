import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import ANY, AsyncMock, patch
from datetime import datetime, timedelta, timezone

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
from app.models.static_ip import StaticIP
from app.models.invoice import Invoice
from app.models.payment import ClientPayment
from app.models.suspension_log import SuspensionLog
from app.workers.billing import generate_monthly_invoices, check_overdue_invoices

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
    # Agregar un gateway
    r = Gateway(
        name="Router Central",
        ip="10.0.0.1",
        api_port=8728,
        api_username="admin",
        password_enc="enc_pass",
        active=True,
    )
    db.add(r)
    # Agregar un plan
    p = Plan(
        name="Plan Fibra 20M",
        speed_down_mbps=20,
        speed_up_mbps=10,
        speed_down_kbps=20000,
        speed_up_kbps=10000,
        price=25.00,
    )
    db.add(p)
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


def test_generate_monthly_invoices_task():
    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()

    # Crear cliente activo con plan activo
    c = Client(
        name="Cliente Activo",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    db.add(c)
    db.flush()
    db.add(ClientPlan(cliente_id=c.id, plan_id=plan.id, estado="activo"))
    db.commit()

    # Ejecutar tarea de facturación mensual
    res = generate_monthly_invoices(force=True)
    assert res["status"] == "success"
    assert res["invoices_created"] == 1

    # Verificar que se creó la factura
    invoice = db.query(Invoice).filter(Invoice.client_id == c.id).first()
    assert invoice is not None
    assert invoice.amount == 25.00
    assert invoice.status == "pending"
    assert invoice.period == datetime.now().strftime("%m/%Y")

    # Ejecutar de nuevo para comprobar protección de duplicados
    res2 = generate_monthly_invoices(force=True)
    assert res2["invoices_created"] == 0
    db.close()


def test_check_overdue_invoices_task():
    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()

    c = Client(
        name="Cliente Con Mora",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    db.add(c)
    db.flush()

    # Crear factura pendiente vencida
    past_due = datetime.now() - timedelta(days=2)
    inv = Invoice(
        client_id=c.id,
        plan_id=plan.id,
        period="05/2026",
        amount=25.00,
        issue_date=datetime.now() - timedelta(days=12),
        due_date=past_due,
        status="pending"
    )
    db.add(inv)
    db.commit()

    # Ejecutar la verificación de vencidos
    res = check_overdue_invoices()
    assert res["status"] == "success"
    assert res["updated_count"] == 1

    # Comprobar actualización de estado
    db.refresh(inv)
    assert inv.status == "overdue"
    db.close()


@patch("app.api.payments.unsuspend_ip_in_firewall")
@patch("app.api.payments.toggle_client_queue")
@patch("app.api.payments.send_suspension_notification")
def test_register_payment_and_reactivation_flow(mock_send_notif, mock_toggle_queue, mock_unsuspend_fw, client: TestClient):
    # Obtener token de admin
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()

    # Crear cliente suspendido
    c = Client(
        name="Cliente Suspendido",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=False
    )
    db.add(c)
    db.flush()
    db.add(StaticIP(client_id=c.id, ip="10.0.0.50", gateway_id=gateway.id))
    db.add(ClientPlan(cliente_id=c.id, plan_id=plan.id, estado="suspendido"))

    # Crear log de suspensión activo (reactivated_at es nulo)
    log = SuspensionLog(
        client_id=c.id,
        reason="Mora de pago",
        suspended_at=datetime.now() - timedelta(days=5),
        reactivated_at=None
    )
    db.add(log)

    # Crear factura vencida
    inv = Invoice(
        client_id=c.id,
        plan_id=plan.id,
        period="05/2026",
        amount=25.00,
        issue_date=datetime.now() - timedelta(days=15),
        due_date=datetime.now() - timedelta(days=5),
        status="overdue"
    )
    db.add(inv)
    db.commit()

    inv_id = inv.id
    client_id = c.id
    db.close()

    # Pagar la factura a través del endpoint POST /api/payments
    response = client.post(
        "/api/payments",
        json={
            "invoice_id": str(inv_id),
            "amount": 25.00,
            "method": "cash",
            "notes": "Pago en oficina principal"
        },
        headers=headers
    )

    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] == "completed"
    assert res_data["method"] == "cash"
    assert res_data["notes"] == "Pago en oficina principal"

    # Comprobar reactivación de entidades en BD
    db2 = TestingSessionLocal()
    client_db = db2.get(Client, client_id)
    assert client_db.active is True

    client_plan_db = db2.query(ClientPlan).filter(ClientPlan.cliente_id == client_id).first()
    assert client_plan_db.estado == "activo"

    log_db = db2.query(SuspensionLog).filter(SuspensionLog.client_id == client_id).first()
    assert log_db.reactivated_at is not None

    invoice_db = db2.get(Invoice, inv_id)
    assert invoice_db.status == "paid"

    # Comprobar llamadas a MikroTik y Notificación
    mock_unsuspend_fw.assert_called_once_with(ANY, "10.0.0.50")
    mock_toggle_queue.assert_called_once_with(ANY, "10.0.0.50", disabled=False)
    mock_send_notif.assert_called_once_with("Cliente Suspendido", "0999999999", is_suspension=False)
    db2.close()


def test_get_daily_cash(client: TestClient):
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()

    c = Client(
        name="Cliente Transaccion",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    db.add(c)
    db.flush()

    # Crear factura
    inv = Invoice(
        client_id=c.id,
        plan_id=plan.id,
        period="06/2026",
        amount=25.00,
        due_date=datetime.now() + timedelta(days=10),
        status="pending"
    )
    db.add(inv)
    db.commit()

    # Crear pago de hoy
    p = ClientPayment(
        client_id=c.id,
        invoice_id=inv.id,
        amount=25.00,
        method="transfer",
        status="completed",
        payment_date=datetime.now()
    )
    db.add(p)
    db.commit()
    db.close()

    # Consultar caja diaria
    response = client.get("/api/payments/today", headers=headers)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["total_collected"] == 25.00
    assert res_data["breakdown"]["transfer"] == 25.00
    assert len(res_data["transactions"]) == 1


def test_generate_monthly_invoices_with_custom_services():
    from app.models.custom_service import CustomService
    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()

    # Agregar servicio personalizado
    cs = CustomService(
        name="IP Publica",
        price=10.00,
        description="IP Fija Publica",
        taxes=12.00,
        active=True
    )
    db.add(cs)
    db.flush()

    # Crear cliente activo con plan activo y servicio personalizado
    c = Client(
        name="Cliente Premium",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    db.add(c)
    db.flush()
    db.add(ClientPlan(cliente_id=c.id, plan_id=plan.id, estado="activo"))

    # Asociar custom service al cliente
    c.custom_services.append(cs)
    db.commit()

    # Ejecutar tarea de facturación mensual
    res = generate_monthly_invoices(force=True)
    assert res["status"] == "success"
    assert res["invoices_created"] == 1

    # Verificar que el monto de la factura sume plan (25.00) + custom service (10.00) = 35.00
    invoice = db.query(Invoice).filter(Invoice.client_id == c.id).first()
    assert invoice is not None
    assert float(invoice.amount) == 35.00
    db.close()


def test_create_manual_invoice_endpoint(client: TestClient):
    # Obtener token de admin
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    db = TestingSessionLocal()
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()

    c = Client(
        name="Cliente Facturacion Manual",
        cedula="1724024888",
        phone="0999999999",
        address="Quito",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    db.add(c)
    db.commit()

    client_id = c.id
    plan_id = plan.id
    db.close()

    # Crear factura manual
    due_date = (datetime.now() + timedelta(days=10)).isoformat()
    response = client.post(
        "/api/invoices",
        json={
            "client_id": str(client_id),
            "plan_id": str(plan_id),
            "period": "07/2026",
            "amount": 50.00,
            "due_date": due_date
        },
        headers=headers
    )

    assert response.status_code == 201
    res_data = response.json()
    assert res_data["period"] == "07/2026"
    assert res_data["amount"] == 50.00
    assert res_data["client_id"] == str(client_id)
    assert res_data["plan_id"] == str(plan_id)
    assert res_data["status"] == "pending"


def test_generate_monthly_invoices_with_non_recurring_custom_services(client: TestClient):
    from app.models.custom_service import CustomService
    db = TestingSessionLocal()

    # 1. Limpiar o buscar datos base
    gateway = db.query(Gateway).first()
    plan = db.query(Plan).first()

    # 2. Crear servicios adicionales: uno recurrente y uno no recurrente
    cs_recurring = CustomService(
        name="Soporte VIP Recurrente",
        price=15.00,
        recurring=True,
        active=True
    )
    cs_non_recurring = CustomService(
        name="Visita Instalacion Unica",
        price=60.00,
        recurring=False,
        active=True
    )
    db.add(cs_recurring)
    db.add(cs_non_recurring)
    db.commit()

    # 3. Crear cliente con plan y ambos servicios personalizados
    c = Client(
        name="Cliente Con Recurrencia Mix",
        cedula="0999888777",
        phone="0987654321",
        address="Guayaquil",
        gateway_id=gateway.id,
        connection_type="static",
        active=True
    )
    c.custom_services.append(cs_recurring)
    c.custom_services.append(cs_non_recurring)
    db.add(c)
    db.commit()

    # Activar plan del cliente
    cp = ClientPlan(
        cliente_id=c.id,
        plan_id=plan.id,
        fecha_inicio=datetime.now(),
        estado="activo"
    )
    db.add(cp)
    db.commit()

    client_id = c.id
    db.close()

    # 4. Ejecutar facturación mensual
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@test.com", "password": "adminpass123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.post("/api/invoices/generate-monthly", headers=headers)
    assert res.status_code == 200

    # 5. Verificar factura generada y desasociación en DB
    db = TestingSessionLocal()
    inv = db.query(Invoice).filter(Invoice.client_id == client_id).first()
    assert inv is not None
    # Monto debe ser: plan.price (25.00) + cs_recurring.price (15.00) + cs_non_recurring.price (60.00) = 100.00
    assert float(inv.amount) == 100.00

    # Los servicios asociados a la factura deben ser ambos
    assert len(inv.custom_services) == 2
    service_names = [s.name for s in inv.custom_services]
    assert "Soporte VIP Recurrente" in service_names
    assert "Visita Instalacion Unica" in service_names

    # El cliente debe haber conservado el servicio recurrente pero perdido el no recurrente
    updated_client = db.get(Client, client_id)
    assert len(updated_client.custom_services) == 1
    assert updated_client.custom_services[0].name == "Soporte VIP Recurrente"

    db.close()
