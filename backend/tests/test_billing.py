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
from app.models.router import Router
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
        nombre="Test Admin",
        email="admin@test.com",
        hashed_password=hash_password("adminpass123"),
        rol="admin",
        activo=True,
    ))
    # Agregar un router
    r = Router(
        nombre="Router Central",
        ip="10.0.0.1",
        puerto_api=8728,
        usuario_api="admin",
        password_enc="enc_pass",
        activo=True,
    )
    db.add(r)
    # Agregar un plan
    p = Plan(
        nombre="Plan Fibra 20M",
        velocidad_down_mbps=20,
        velocidad_up_mbps=10,
        velocidad_down_kbps=20000,
        velocidad_up_kbps=10000,
        precio=25.00,
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
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    
    # Crear cliente activo con plan activo
    c = Client(
        nombre="Cliente Activo",
        cedula="1724024888",
        telefono="0999999999",
        direccion="Quito",
        router_id=router.id,
        tipo="static",
        activo=True
    )
    db.add(c)
    db.flush()
    db.add(ClientPlan(cliente_id=c.id, plan_id=plan.id, estado="activo"))
    db.commit()
    
    # Ejecutar tarea de facturación mensual
    res = generate_monthly_invoices()
    assert res["status"] == "success"
    assert res["invoices_created"] == 1
    
    # Verificar que se creó la factura
    invoice = db.query(Invoice).filter(Invoice.cliente_id == c.id).first()
    assert invoice is not None
    assert invoice.monto == 25.00
    assert invoice.estado == "pendiente"
    assert invoice.periodo == datetime.now().strftime("%m/%Y")
    
    # Ejecutar de nuevo para comprobar protección de duplicados
    res2 = generate_monthly_invoices()
    assert res2["invoices_created"] == 0
    db.close()


def test_check_overdue_invoices_task():
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    
    c = Client(
        nombre="Cliente Con Mora",
        cedula="1724024888",
        telefono="0999999999",
        direccion="Quito",
        router_id=router.id,
        tipo="static",
        activo=True
    )
    db.add(c)
    db.flush()
    
    # Crear factura pendiente vencida
    past_due = datetime.now() - timedelta(days=2)
    inv = Invoice(
        cliente_id=c.id,
        plan_id=plan.id,
        periodo="05/2026",
        monto=25.00,
        fecha_emision=datetime.now() - timedelta(days=12),
        fecha_vencimiento=past_due,
        estado="pendiente"
    )
    db.add(inv)
    db.commit()
    
    # Ejecutar la verificación de vencidos
    res = check_overdue_invoices()
    assert res["status"] == "success"
    assert res["updated_count"] == 1
    
    # Comprobar actualización de estado
    db.refresh(inv)
    assert inv.estado == "vencido"
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
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    
    # Crear cliente suspendido
    c = Client(
        nombre="Cliente Suspendido",
        cedula="1724024888",
        telefono="0999999999",
        direccion="Quito",
        router_id=router.id,
        tipo="static",
        activo=False
    )
    db.add(c)
    db.flush()
    db.add(StaticIP(cliente_id=c.id, ip="10.0.0.50", router_id=router.id))
    db.add(ClientPlan(cliente_id=c.id, plan_id=plan.id, estado="suspendido"))
    
    # Crear log de suspensión activo (fecha_reactivacion es nula)
    log = SuspensionLog(
        cliente_id=c.id,
        motivo="Mora de pago",
        fecha_suspension=datetime.now() - timedelta(days=5),
        fecha_reactivacion=None
    )
    db.add(log)
    
    # Crear factura vencida
    inv = Invoice(
        cliente_id=c.id,
        plan_id=plan.id,
        periodo="05/2026",
        monto=25.00,
        fecha_emision=datetime.now() - timedelta(days=15),
        fecha_vencimiento=datetime.now() - timedelta(days=5),
        estado="vencido"
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
            "monto": 25.00,
            "metodo": "efectivo",
            "notas": "Pago en oficina principal"
        },
        headers=headers
    )
    
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["estado"] == "completado"
    assert res_data["metodo"] == "efectivo"
    assert res_data["notas"] == "Pago en oficina principal"
    
    # Comprobar reactivación de entidades en BD
    db2 = TestingSessionLocal()
    client_db = db2.get(Client, client_id)
    assert client_db.activo is True
    
    client_plan_db = db2.query(ClientPlan).filter(ClientPlan.cliente_id == client_id).first()
    assert client_plan_db.estado == "activo"
    
    log_db = db2.query(SuspensionLog).filter(SuspensionLog.cliente_id == client_id).first()
    assert log_db.fecha_reactivacion is not None
    
    invoice_db = db2.get(Invoice, inv_id)
    assert invoice_db.estado == "pagado"
    
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
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    
    c = Client(
        nombre="Cliente Transaccion",
        cedula="1724024888",
        telefono="0999999999",
        direccion="Quito",
        router_id=router.id,
        tipo="static",
        activo=True
    )
    db.add(c)
    db.flush()
    
    # Crear factura
    inv = Invoice(
        cliente_id=c.id,
        plan_id=plan.id,
        periodo="06/2026",
        monto=25.00,
        fecha_vencimiento=datetime.now() + timedelta(days=10),
        estado="pendiente"
    )
    db.add(inv)
    db.commit()
    
    # Crear pago de hoy
    p = ClientPayment(
        cliente_id=c.id,
        invoice_id=inv.id,
        monto=25.00,
        metodo="transferencia",
        estado="completado",
        fecha_pago=datetime.now()
    )
    db.add(p)
    db.commit()
    db.close()
    
    # Consultar caja diaria
    response = client.get("/api/payments/today", headers=headers)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["total_cobrado"] == 25.00
    assert res_data["desglose"]["transferencia"] == 25.00
    assert len(res_data["transacciones"]) == 1


def test_generate_monthly_invoices_with_custom_services():
    from app.models.custom_service import CustomService
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()

    # Agregar servicio personalizado
    cs = CustomService(
        nombre="IP Publica",
        precio=10.00,
        descripcion="IP Fija Publica",
        impuestos=12.00,
        activo=True
    )
    db.add(cs)
    db.flush()

    # Crear cliente activo con plan activo y servicio personalizado
    c = Client(
        nombre="Cliente Premium",
        cedula="1724024888",
        telefono="0999999999",
        direccion="Quito",
        router_id=router.id,
        tipo="static",
        activo=True
    )
    db.add(c)
    db.flush()
    db.add(ClientPlan(cliente_id=c.id, plan_id=plan.id, estado="activo"))
    
    # Asociar custom service al cliente
    c.custom_services.append(cs)
    db.commit()

    # Ejecutar tarea de facturación mensual
    res = generate_monthly_invoices()
    assert res["status"] == "success"
    assert res["invoices_created"] == 1

    # Verificar que el monto de la factura sume plan (25.00) + custom service (10.00) = 35.00
    invoice = db.query(Invoice).filter(Invoice.cliente_id == c.id).first()
    assert invoice is not None
    assert float(invoice.monto) == 35.00
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
    router = db.query(Router).first()
    plan = db.query(Plan).first()

    c = Client(
        nombre="Cliente Facturacion Manual",
        cedula="1724024888",
        telefono="0999999999",
        direccion="Quito",
        router_id=router.id,
        tipo="static",
        activo=True
    )
    db.add(c)
    db.commit()

    client_id = c.id
    plan_id = plan.id
    db.close()

    # Crear factura manual
    vencimiento = (datetime.now() + timedelta(days=10)).isoformat()
    response = client.post(
        "/api/invoices",
        json={
            "cliente_id": str(client_id),
            "plan_id": str(plan_id),
            "periodo": "07/2026",
            "monto": 50.00,
            "fecha_vencimiento": vencimiento
        },
        headers=headers
    )

    assert response.status_code == 201
    res_data = response.json()
    assert res_data["periodo"] == "07/2026"
    assert res_data["monto"] == 50.00
    assert res_data["cliente_id"] == str(client_id)
    assert res_data["plan_id"] == str(plan_id)
    assert res_data["estado"] == "pendiente"


def test_generate_monthly_invoices_with_non_recurring_custom_services(client: TestClient):
    from app.models.custom_service import CustomService
    db = TestingSessionLocal()
    
    # 1. Limpiar o buscar datos base
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    
    # 2. Crear servicios adicionales: uno recurrente y uno no recurrente
    cs_recurrente = CustomService(
        nombre="Soporte VIP Recurrente",
        precio=15.00,
        recurrente=True,
        activo=True
    )
    cs_no_recurrente = CustomService(
        nombre="Visita Instalacion Unica",
        precio=60.00,
        recurrente=False,
        activo=True
    )
    db.add(cs_recurrente)
    db.add(cs_no_recurrente)
    db.commit()
    
    # 3. Crear cliente con plan y ambos servicios personalizados
    c = Client(
        nombre="Cliente Con Recurrencia Mix",
        cedula="0999888777",
        telefono="0987654321",
        direccion="Guayaquil",
        router_id=router.id,
        tipo="static",
        activo=True
    )
    c.custom_services.append(cs_recurrente)
    c.custom_services.append(cs_no_recurrente)
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
    inv = db.query(Invoice).filter(Invoice.cliente_id == client_id).first()
    assert inv is not None
    # Monto debe ser: plan.precio (25.00) + cs_recurrente.precio (15.00) + cs_no_recurrente.precio (60.00) = 100.00
    assert float(inv.monto) == 100.00
    
    # Los servicios asociados a la factura deben ser ambos
    assert len(inv.custom_services) == 2
    service_names = [s.nombre for s in inv.custom_services]
    assert "Soporte VIP Recurrente" in service_names
    assert "Visita Instalacion Unica" in service_names
    
    # El cliente debe haber conservado el servicio recurrente pero perdido el no recurrente
    updated_client = db.get(Client, client_id)
    assert len(updated_client.custom_services) == 1
    assert updated_client.custom_services[0].nombre == "Soporte VIP Recurrente"
    
    db.close()

