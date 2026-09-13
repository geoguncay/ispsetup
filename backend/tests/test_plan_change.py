"""
Tests para el cambio de plan de un cliente: modo inmediato (con ajuste
prorrateado) y modo diferido ("al iniciar nuevo periodo").
"""
import pytest
from datetime import datetime, timedelta, timezone
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
from app.models.system_settings import SystemSettings
from app.services.billing_cycle import compute_plan_change_proration, current_period_bounds
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
        name="Test Admin",
        email="admin@test.com",
        hashed_password=hash_password("adminpass123"),
        role="admin",
        active=True,
    ))
    router = Router(
        name="Router Central",
        ip="10.0.0.1",
        api_port=8728,
        api_username="admin",
        password_enc="enc_pass",
        active=True,
    )
    db.add(router)
    db.add(Plan(
        name="Plan Básico 10M", speed_down_mbps=10, speed_up_mbps=5,
        speed_down_kbps=10000, speed_up_kbps=5000, price=20.00,
    ))
    db.add(Plan(
        name="Plan Fibra 50M", speed_down_mbps=50, speed_up_mbps=25,
        speed_down_kbps=50000, speed_up_kbps=25000, price=40.00,
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


def _make_client_with_active_plan(db, router_id, plan_id, cedula="1724024888") -> Client:
    """Cliente sin IP estática ni secreto PPPoE: apply_plan_change no intenta tocar MikroTik."""
    c = Client(
        full_name="Cliente Con Plan", cedula=cedula, phone="0999999999", address="Quito",
        router_id=router_id, access_method="static", active=True,
    )
    db.add(c)
    db.flush()
    db.add(ClientPlan(cliente_id=c.id, plan_id=plan_id, estado="activo"))
    db.commit()
    db.refresh(c)
    return c


# ── Cálculo puro de prorrateo ───────────────────────────────────────────────

def test_compute_plan_change_proration_upgrade_charges_remaining_days():
    db = TestingSessionLocal()
    cfg = SystemSettings(billing_generation_mode="fixed_day", billing_default_payment_day=1)
    router = db.query(Router).first()
    client_obj = Client(
        full_name="X", cedula="1724024888", phone="0999999999", address="Quito",
        router_id=router.id, access_method="static", active=True,
    )
    db.add(client_obj)
    db.commit()

    # Periodo del 01/06 al 01/07; "hoy" es el 11/06 -> quedan 20 de 30 días.
    now = datetime(2026, 6, 11, 12, 0, 0)
    period_start, period_end = current_period_bounds(client_obj, cfg, now)
    assert period_start == datetime(2026, 6, 1)
    assert period_end == datetime(2026, 7, 1)

    amount, days_remaining, days_in_period = compute_plan_change_proration(20.0, 40.0, client_obj, cfg, now)
    assert days_in_period == 30
    assert days_remaining == 20
    assert amount == round((40.0 - 20.0) * 20 / 30, 2)
    assert amount > 0  # upgrade -> cargo adicional
    db.close()


def test_compute_plan_change_proration_downgrade_is_credit():
    db = TestingSessionLocal()
    cfg = SystemSettings(billing_generation_mode="fixed_day", billing_default_payment_day=1)
    router = db.query(Router).first()
    client_obj = Client(
        full_name="X", cedula="1724024889", phone="0999999999", address="Quito",
        router_id=router.id, access_method="static", active=True,
    )
    db.add(client_obj)
    db.commit()

    now = datetime(2026, 6, 11, 12, 0, 0)
    amount, days_remaining, days_in_period = compute_plan_change_proration(40.0, 20.0, client_obj, cfg, now)
    assert amount < 0  # downgrade -> crédito a favor del cliente
    assert amount == round((20.0 - 40.0) * days_remaining / days_in_period, 2)
    db.close()


# ── Endpoint /plan-change-preview ───────────────────────────────────────────

def test_plan_change_preview_matches_immediate_assignment(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    old_plan = db.query(Plan).filter(Plan.name == "Plan Básico 10M").first()
    new_plan = db.query(Plan).filter(Plan.name == "Plan Fibra 50M").first()
    c = _make_client_with_active_plan(db, router.id, old_plan.id)
    client_id, new_plan_id = c.id, new_plan.id
    db.close()

    headers = {"Authorization": f"Bearer {token}"}
    preview_resp = client.get(
        f"/api/clients/{client_id}/plan-change-preview",
        headers=headers, params={"plan_id": str(new_plan_id)},
    )
    assert preview_resp.status_code == 200
    preview = preview_resp.json()
    assert preview["old_plan"]["name"] == "Plan Básico 10M"
    assert preview["new_plan"]["name"] == "Plan Fibra 50M"
    assert preview["is_same_plan"] is False
    assert preview["immediate_adjustment_amount"] > 0  # upgrade
    assert preview["next_period_amount"] == 40.0

    assign_resp = client.post(
        f"/api/clients/{client_id}/assign-plan",
        headers=headers, params={"plan_id": str(new_plan_id), "mode": "immediate"},
    )
    assert assign_resp.json()["adjustment_amount"] == preview["immediate_adjustment_amount"]


def test_plan_change_preview_same_plan(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).filter(Plan.name == "Plan Básico 10M").first()
    c = _make_client_with_active_plan(db, router.id, plan.id)
    client_id, plan_id = c.id, plan.id
    db.close()

    response = client.get(
        f"/api/clients/{client_id}/plan-change-preview",
        headers={"Authorization": f"Bearer {token}"}, params={"plan_id": str(plan_id)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_same_plan"] is True
    assert body["immediate_adjustment_amount"] == 0.0


# ── Endpoint /assign-plan ────────────────────────────────────────────────────

def test_immediate_plan_change_creates_adjustment_invoice(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    old_plan = db.query(Plan).filter(Plan.name == "Plan Básico 10M").first()
    new_plan = db.query(Plan).filter(Plan.name == "Plan Fibra 50M").first()
    c = _make_client_with_active_plan(db, router.id, old_plan.id)
    client_id, old_plan_id, new_plan_id = c.id, old_plan.id, new_plan.id
    db.close()

    response = client.post(
        f"/api/clients/{client_id}/assign-plan",
        headers={"Authorization": f"Bearer {token}"},
        params={"plan_id": str(new_plan_id), "mode": "immediate"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "immediate"

    db = TestingSessionLocal()
    active_plan = db.query(ClientPlan).filter(ClientPlan.cliente_id == client_id, ClientPlan.estado == "activo").first()
    assert active_plan is not None
    assert active_plan.plan_id == new_plan_id

    cancelled_plan = db.query(ClientPlan).filter(ClientPlan.cliente_id == client_id, ClientPlan.estado == "cancelado").first()
    assert cancelled_plan is not None
    assert cancelled_plan.plan_id == old_plan_id

    adjustment = db.query(Invoice).filter(Invoice.client_id == client_id).first()
    assert adjustment is not None
    assert adjustment.concept is not None and "Ajuste por cambio de plan" in adjustment.concept
    assert adjustment.amount > 0  # upgrade de $20 a $40
    db.close()


def test_immediate_plan_change_adjustment_includes_tax_when_price_mode_excluded(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    db.add(SystemSettings(fiscal_tax_rate=15.0, billing_price_mode="excluded"))
    db.commit()

    router = db.query(Router).first()
    old_plan = db.query(Plan).filter(Plan.name == "Plan Básico 10M").first()  # price = 20.00
    new_plan = db.query(Plan).filter(Plan.name == "Plan Fibra 50M").first()  # price = 40.00
    c = _make_client_with_active_plan(db, router.id, old_plan.id)
    client_id, new_plan_id = c.id, new_plan.id
    db.close()

    preview_resp = client.get(
        f"/api/clients/{client_id}/plan-change-preview",
        headers={"Authorization": f"Bearer {token}"}, params={"plan_id": str(new_plan_id)},
    )
    preview = preview_resp.json()
    # (40*1.15 - 20*1.15) = 23.00 de diferencia total del periodo, prorrateada por los días restantes.
    expected_full_diff = 40 * 1.15 - 20 * 1.15
    assert preview["immediate_adjustment_amount"] == round(expected_full_diff * preview["days_remaining"] / preview["days_in_period"], 2)
    assert preview["next_period_amount"] == 46.0  # 40 * 1.15

    response = client.post(
        f"/api/clients/{client_id}/assign-plan",
        headers={"Authorization": f"Bearer {token}"},
        params={"plan_id": str(new_plan_id), "mode": "immediate"},
    )
    assert response.json()["adjustment_amount"] == preview["immediate_adjustment_amount"]


def test_immediate_plan_change_rejects_same_plan(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    plan = db.query(Plan).filter(Plan.name == "Plan Básico 10M").first()
    c = _make_client_with_active_plan(db, router.id, plan.id)
    client_id, plan_id = c.id, plan.id
    db.close()

    response = client.post(
        f"/api/clients/{client_id}/assign-plan",
        headers={"Authorization": f"Bearer {token}"},
        params={"plan_id": str(plan_id), "mode": "immediate"},
    )
    assert response.status_code == 400


def test_next_period_change_schedules_without_touching_active_plan(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    old_plan = db.query(Plan).filter(Plan.name == "Plan Básico 10M").first()
    new_plan = db.query(Plan).filter(Plan.name == "Plan Fibra 50M").first()
    c = _make_client_with_active_plan(db, router.id, old_plan.id)
    client_id, old_plan_id, new_plan_id = c.id, old_plan.id, new_plan.id
    db.close()

    response = client.post(
        f"/api/clients/{client_id}/assign-plan",
        headers={"Authorization": f"Bearer {token}"},
        params={"plan_id": str(new_plan_id), "mode": "next_period"},
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "next_period"

    db = TestingSessionLocal()
    refreshed = db.query(Client).filter(Client.id == client_id).first()
    assert refreshed.pending_plan_id == new_plan_id

    # El plan activo NO cambió todavía.
    active_plan = db.query(ClientPlan).filter(ClientPlan.cliente_id == client_id, ClientPlan.estado == "activo").first()
    assert active_plan.plan_id == old_plan_id

    # No se generó ningún ajuste de facturación.
    assert db.query(Invoice).filter(Invoice.client_id == client_id).count() == 0
    db.close()

    # El detalle del cliente expone el plan pendiente (lo que usa el banner del frontend).
    detail = client.get(f"/api/clients/{client_id}", headers={"Authorization": f"Bearer {token}"})
    assert detail.status_code == 200
    assert detail.json()["pending_plan"]["name"] == "Plan Fibra 50M"


def test_next_period_change_requires_existing_active_plan(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    new_plan = db.query(Plan).filter(Plan.name == "Plan Fibra 50M").first()
    c = Client(
        full_name="Sin Plan", cedula="1724024890", phone="0999999999", address="Quito",
        router_id=router.id, access_method="static", active=True,
    )
    db.add(c)
    db.commit()
    client_id, new_plan_id = c.id, new_plan.id
    db.close()

    response = client.post(
        f"/api/clients/{client_id}/assign-plan",
        headers={"Authorization": f"Bearer {token}"},
        params={"plan_id": str(new_plan_id), "mode": "next_period"},
    )
    assert response.status_code == 400


def test_cancel_pending_plan_change(client: TestClient):
    token = _login(client)
    db = TestingSessionLocal()
    router = db.query(Router).first()
    old_plan = db.query(Plan).filter(Plan.name == "Plan Básico 10M").first()
    new_plan = db.query(Plan).filter(Plan.name == "Plan Fibra 50M").first()
    c = _make_client_with_active_plan(db, router.id, old_plan.id)
    client_id, new_plan_id = c.id, new_plan.id
    db.close()

    headers = {"Authorization": f"Bearer {token}"}
    client.post(f"/api/clients/{client_id}/assign-plan", headers=headers, params={"plan_id": str(new_plan_id), "mode": "next_period"})

    cancel_resp = client.delete(f"/api/clients/{client_id}/pending-plan-change", headers=headers)
    assert cancel_resp.status_code == 200

    db = TestingSessionLocal()
    refreshed = db.query(Client).filter(Client.id == client_id).first()
    assert refreshed.pending_plan_id is None
    db.close()

    # Cancelar de nuevo cuando ya no hay nada pendiente -> 400
    cancel_again = client.delete(f"/api/clients/{client_id}/pending-plan-change", headers=headers)
    assert cancel_again.status_code == 400


# ── Aplicación automática en la facturación mensual ─────────────────────────

def test_generate_monthly_invoices_applies_pending_plan_change():
    db = TestingSessionLocal()
    router = db.query(Router).first()
    old_plan = db.query(Plan).filter(Plan.name == "Plan Básico 10M").first()
    new_plan = db.query(Plan).filter(Plan.name == "Plan Fibra 50M").first()

    c = Client(
        # De alta hace tiempo (no en su primer periodo): el cambio de plan
        # diferido factura el plan nuevo completo, sin prorratear por alta.
        full_name="Cliente Diferido", cedula="1724024891", phone="0999999999", address="Quito",
        router_id=router.id, access_method="static", active=True,
        created_at=datetime(2020, 1, 1),
        pending_plan_id=new_plan.id, pending_plan_requested_at=datetime.now(timezone.utc),
    )
    db.add(c)
    db.flush()
    db.add(ClientPlan(cliente_id=c.id, plan_id=old_plan.id, estado="activo"))
    db.commit()
    client_id = c.id
    new_plan_id = new_plan.id
    db.close()

    res = generate_monthly_invoices(force=True)
    assert res["status"] == "success"
    assert res["invoices_created"] == 1

    db = TestingSessionLocal()
    refreshed = db.query(Client).filter(Client.id == client_id).first()
    assert refreshed.pending_plan_id is None

    active_plan = db.query(ClientPlan).filter(ClientPlan.cliente_id == client_id, ClientPlan.estado == "activo").first()
    assert active_plan.plan_id == new_plan_id

    invoice = db.query(Invoice).filter(Invoice.client_id == client_id).first()
    assert invoice is not None
    assert float(invoice.amount) == 40.00  # ya factura el plan nuevo completo, sin prorrateo
    db.close()
