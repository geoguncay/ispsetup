"""
Tests para editar/eliminar facturas pendientes o vencidas (sin pagos), y anular
facturas ya pagadas (lo que también anula su pago asociado). Una factura anulada
libera su periodo para poder volver a facturarse automáticamente.
"""
import pytest
from datetime import datetime, timedelta
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
from app.models.plan import Plan
from app.models.router import Router
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.invoice import Invoice
from app.models.payment import ClientPayment
from app.workers.billing import generate_monthly_invoices

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
        name="Test Admin", email="admin@test.com",
        hashed_password=hash_password("adminpass123"), role="admin", active=True,
    ))
    router = Router(
        name="Router Central", ip="10.0.0.1", api_port=8728,
        api_username="admin", password_enc="enc_pass", active=True,
    )
    db.add(router)
    db.add(Plan(
        name="Plan Fibra 20M", speed_down_mbps=20, speed_up_mbps=10,
        speed_down_kbps=20000, speed_up_kbps=10000, price=25.00,
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


def _login(client: TestClient) -> str:
    resp = client.post("/api/auth/login", json={"email": "admin@test.com", "password": "adminpass123"})
    return resp.json()["access_token"]


def _make_client(db, router_id, cedula="1724024888") -> Client:
    c = Client(
        full_name="Cliente Facturas", cedula=cedula, phone="0999999999", address="Quito",
        router_id=router_id, access_method="static", active=True,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _make_invoice(db, client_id, plan_id, amount=25.00, period="09/2026", status="pending") -> Invoice:
    inv = Invoice(
        client_id=client_id, plan_id=plan_id, period=period, amount=amount,
        issue_date=datetime.now(), due_date=datetime.now() + timedelta(days=10), status=status,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


# ── Anular (solo pagadas) ────────────────────────────────────────────────────

def test_void_paid_invoice_also_cancels_payment(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id, status="paid")
    payment = ClientPayment(client_id=c.id, invoice_id=inv.id, amount=25.00, method="cash", status="completed")
    db.add(payment)
    db.commit()
    invoice_id, payment_id = inv.id, payment.id
    db.close()

    response = client.post(f"/api/invoices/{invoice_id}/void", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"

    db = TestingSessionLocal()
    refreshed_payment = db.get(ClientPayment, payment_id)
    assert refreshed_payment.status == "cancelled"
    db.close()

    # Anular de nuevo -> 400
    again = client.post(f"/api/invoices/{invoice_id}/void", headers={"Authorization": f"Bearer {token}"})
    assert again.status_code == 400


def test_void_pending_invoice_rejected(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id, status="pending")
    invoice_id = inv.id
    db.close()

    response = client.post(f"/api/invoices/{invoice_id}/void", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 400


# ── Editar (solo pendientes/vencidas) ────────────────────────────────────────

def test_edit_pending_invoice(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id, amount=25.00, period="09/2026")
    invoice_id = inv.id
    db.close()

    response = client.put(
        f"/api/invoices/{invoice_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount": 30.00, "period": "10/2026", "concept": "Corrección de monto"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["amount"] == 30.00
    assert body["period"] == "10/2026"
    assert body["concept"] == "Corrección de monto"


def test_edit_invoice_rejects_due_date_before_issue_date(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id)
    invoice_id = inv.id
    db.close()

    past_due_date = (datetime.now() - timedelta(days=5)).isoformat()
    response = client.put(
        f"/api/invoices/{invoice_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"due_date": past_due_date},
    )
    assert response.status_code == 400


def test_edit_overdue_invoice_reverts_to_pending_when_due_date_moved_forward(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id, status="overdue")
    invoice_id = inv.id
    db.close()

    future_due_date = (datetime.now() + timedelta(days=15)).isoformat()
    response = client.put(
        f"/api/invoices/{invoice_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"due_date": future_due_date},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "pending"


def test_edit_paid_invoice_rejected(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id, status="paid")
    invoice_id = inv.id
    db.close()

    response = client.put(
        f"/api/invoices/{invoice_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount": 99.00},
    )
    assert response.status_code == 400


# ── Eliminar (solo pendientes/vencidas) ──────────────────────────────────────

def test_delete_pending_invoice(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id)
    invoice_id = inv.id
    db.close()

    response = client.delete(f"/api/invoices/{invoice_id}", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 204

    db = TestingSessionLocal()
    assert db.get(Invoice, invoice_id) is None
    db.close()


def test_delete_paid_invoice_rejected(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id, status="paid")
    db.add(ClientPayment(client_id=c.id, invoice_id=inv.id, amount=25.00, method="cash", status="completed"))
    db.commit()
    invoice_id = inv.id
    db.close()

    response = client.delete(f"/api/invoices/{invoice_id}", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 400

    db = TestingSessionLocal()
    assert db.get(Invoice, invoice_id) is not None
    db.close()


def test_delete_cancelled_invoice_with_payment_rejected(client: TestClient):
    """Una factura anulada conserva su pago (también anulado): no se elimina — se preserva por auditoría."""
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id)
    inv = _make_invoice(db, c.id, plan.id, status="cancelled")
    db.add(ClientPayment(client_id=c.id, invoice_id=inv.id, amount=25.00, method="cash", status="cancelled"))
    db.commit()
    invoice_id = inv.id
    db.close()

    response = client.delete(f"/api/invoices/{invoice_id}", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 400


# ── Aplicación automática en la facturación mensual ─────────────────────────

def test_cancelled_invoice_frees_period_for_regeneration():
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).first()
    c = _make_client(db, router.id, cedula="1724024899")
    db.add(ClientPlan(cliente_id=c.id, plan_id=plan.id, estado="activo"))
    current_period = datetime.now().strftime("%m/%Y")
    _make_invoice(db, c.id, plan.id, period=current_period, status="cancelled")

    res = generate_monthly_invoices(force=True)
    assert res["status"] == "success"
    assert res["invoices_created"] == 1

    invoices = db.query(Invoice).filter(Invoice.client_id == c.id).all()
    statuses = sorted(inv.status for inv in invoices)
    assert statuses == ["cancelled", "pending"]
    db.close()
