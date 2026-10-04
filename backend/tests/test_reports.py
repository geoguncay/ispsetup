"""Tests del módulo de Reportes (Fase 4.3): ingresos, clientes, consumo y mora."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
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
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.invoice import Invoice
from app.models.payment import ClientPayment
from app.models.plan import Plan
from app.models.router import Router
from app.models.site import Site
from app.models.suspension_log import SuspensionLog
from app.models.traffic_sample import TrafficSample
from app.models.user import User
from app.services.reports.queries import (
    get_clients_report,
    get_consumption_report,
    get_overdue_report,
    get_revenue_period_detail,
    get_revenue_report,
)

engine_test = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _client(db, router, name="Cliente", cedula="1710000001", active=True) -> Client:
    c = Client(
        full_name=name, cedula=cedula, phone="0999999999", address="Quito",
        router_id=router.id, access_method="static", active=active,
    )
    db.add(c)
    db.flush()
    return c


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setattr(db_module, "engine", engine_test)
    monkeypatch.setattr(db_module, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr("app.api.auth.redis_client", AsyncMock())
    Base.metadata.create_all(bind=engine_test)

    db = TestingSessionLocal()
    db.add(User(
        name="Admin", email="admin@test.com", hashed_password=hash_password("adminpass123"),
        role="admin", active=True,
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


def _token(client: TestClient) -> str:
    r = client.post("/api/auth/login", json={"email": "admin@test.com", "password": "adminpass123"})
    return r.json()["access_token"]


# ── Reporte de ingresos ──────────────────────────────────────────────────────
def test_revenue_report_aggregates_by_period_plan_and_site():
    db = TestingSessionLocal()
    site = Site(name="Sitio Norte")
    db.add(site)
    db.flush()
    router = Router(name="R1", ip="10.0.0.1", api_port=8728, api_username="a", password_enc="x", site_id=site.id)
    db.add(router)
    db.flush()
    plan_a = Plan(name="Plan A", speed_down_mbps=10, speed_up_mbps=5, price=20.0)
    plan_b = Plan(name="Plan B", speed_down_mbps=20, speed_up_mbps=10, price=30.0)
    db.add_all([plan_a, plan_b])
    db.flush()

    c1 = _client(db, router, "Cliente Uno", "1710000001")
    c2 = _client(db, router, "Cliente Dos", "1710000002")

    inv1 = Invoice(client_id=c1.id, plan_id=plan_a.id, period="01/2026", amount=20.0, due_date=datetime.now(timezone.utc), status="paid")
    inv2 = Invoice(client_id=c2.id, plan_id=plan_b.id, period="02/2026", amount=30.0, due_date=datetime.now(timezone.utc), status="paid")
    db.add_all([inv1, inv2])
    db.flush()

    jan = datetime(2026, 1, 15, tzinfo=timezone.utc)
    feb = datetime(2026, 2, 10, tzinfo=timezone.utc)
    db.add(ClientPayment(client_id=c1.id, invoice_id=inv1.id, amount=20.0, payment_date=jan, method="cash", status="completed"))
    db.add(ClientPayment(client_id=c2.id, invoice_id=inv2.id, amount=30.0, payment_date=feb, method="cash", status="completed"))
    # Pago fallido: no debe contarse.
    db.add(ClientPayment(client_id=c2.id, invoice_id=inv2.id, amount=30.0, payment_date=feb, method="card", status="failed"))
    db.commit()

    report = get_revenue_report(
        db, "month", datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 2, 28, tzinfo=timezone.utc)
    )
    assert report.total_amount == 50.0
    assert report.total_payments == 2
    assert [p.label for p in report.by_period] == ["2026-01", "2026-02"]
    assert {p.plan_name for p in report.by_plan} == {"Plan A", "Plan B"}
    assert report.by_site[0].site_name == "Sitio Norte"
    assert sum(s.amount for s in report.by_site) == 50.0
    db.close()


def test_revenue_report_groups_by_quarter_and_year():
    db = TestingSessionLocal()
    router = Router(name="R1", ip="10.0.0.1", api_port=8728, api_username="a", password_enc="x")
    db.add(router)
    db.flush()
    c1 = _client(db, router)
    db.add(ClientPayment(
        client_id=c1.id, amount=15.0, payment_date=datetime(2026, 5, 1, tzinfo=timezone.utc),
        method="cash", status="completed",
    ))
    db.commit()

    q_report = get_revenue_report(
        db, "quarter", datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 12, 31, tzinfo=timezone.utc)
    )
    assert q_report.by_period[0].label == "2026-Q2"

    y_report = get_revenue_report(
        db, "year", datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 12, 31, tzinfo=timezone.utc)
    )
    assert y_report.by_period[0].label == "2026"
    db.close()


def test_revenue_report_rejects_invalid_group_by():
    db = TestingSessionLocal()
    with pytest.raises(ValueError):
        get_revenue_report(db, "week", datetime.now(timezone.utc) - timedelta(days=1), datetime.now(timezone.utc))
    db.close()


def test_revenue_period_detail_simple_and_accumulated():
    db = TestingSessionLocal()
    router = Router(name="R1", ip="10.0.0.1", api_port=8728, api_username="a", password_enc="x")
    db.add(router)
    db.flush()
    c1 = _client(db, router)
    for amount, when in [(10.0, datetime(2026, 1, 5, tzinfo=timezone.utc)),
                         (20.0, datetime(2026, 2, 5, tzinfo=timezone.utc)),
                         (5.0, datetime(2026, 2, 20, tzinfo=timezone.utc)),
                         (99.0, datetime(2026, 3, 1, tzinfo=timezone.utc))]:
        db.add(ClientPayment(client_id=c1.id, amount=amount, payment_date=when, method="cash", status="completed"))
    db.commit()

    detail = get_revenue_period_detail(db, "2026-02", "month", datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert detail.simple.total_amount == 25.0
    assert [p.label for p in detail.simple.series] == ["2026-02-05", "2026-02-20"]
    assert detail.accumulated.total_amount == 35.0
    acc = {p.label: p.amount for p in detail.accumulated.series}
    assert len(acc) == 31 + 28  # 1-ene a 28-feb, día a día
    assert acc["2026-01-04"] == 0.0 and acc["2026-01-05"] == 10.0
    assert acc["2026-02-05"] == 30.0 and acc["2026-02-28"] == 35.0

    with pytest.raises(ValueError):
        get_revenue_period_detail(db, "xx", "month", datetime(2026, 1, 1, tzinfo=timezone.utc))
    db.close()


# ── Reporte de clientes ───────────────────────────────────────────────────────
def test_clients_report_counts_new_suspended_and_churned():
    db = TestingSessionLocal()
    router = Router(name="R1", ip="10.0.0.1", api_port=8728, api_username="a", password_enc="x")
    db.add(router)
    db.flush()
    plan = Plan(name="Plan A", speed_down_mbps=10, speed_up_mbps=5, price=20.0)
    db.add(plan)
    db.flush()

    active_client = _client(db, router, "Activo", "1710000010", active=True)
    suspended_client = _client(db, router, "Suspendido", "1710000011", active=False)
    db.flush()
    # created_at tiene server_default=now(); lo forzamos a enero para el test de evolución.
    active_client.created_at = datetime(2026, 1, 5, tzinfo=timezone.utc)
    suspended_client.created_at = datetime(2026, 1, 6, tzinfo=timezone.utc)

    db.add(SuspensionLog(
        client_id=suspended_client.id, reason="mora",
        suspended_at=datetime(2026, 1, 20, tzinfo=timezone.utc),
    ))
    db.add(ClientPlan(
        cliente_id=active_client.id, plan_id=plan.id, estado="cancelado",
        fecha_fin=datetime(2026, 1, 25, tzinfo=timezone.utc),
    ))
    db.commit()

    report = get_clients_report(
        db, datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 1, 31, tzinfo=timezone.utc)
    )
    assert report.total_clients == 2
    assert report.active_clients == 1
    assert report.suspended_clients == 1
    jan_point = next(p for p in report.evolution if p.label == "2026-01")
    assert jan_point.new_clients == 2
    assert jan_point.suspended_events == 1
    assert jan_point.churned_clients == 1
    db.close()


def test_clients_report_evolution_has_no_gaps():
    db = TestingSessionLocal()
    report = get_clients_report(
        db, datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 3, 31, tzinfo=timezone.utc)
    )
    assert [p.label for p in report.evolution] == ["2026-01", "2026-02", "2026-03"]
    db.close()


# ── Reporte de consumo ────────────────────────────────────────────────────────
def test_consumption_report_top_consumers_and_peak_hours():
    db = TestingSessionLocal()
    router = Router(name="R1", ip="10.0.0.1", api_port=8728, api_username="a", password_enc="x")
    db.add(router)
    db.flush()
    plan = Plan(name="Plan A", speed_down_mbps=10, speed_up_mbps=5, price=20.0)
    db.add(plan)
    db.flush()
    c1 = _client(db, router, "Cliente Grande", "1710000020")
    c2 = _client(db, router, "Cliente Chico", "1710000021")
    db.add(ClientPlan(cliente_id=c1.id, plan_id=plan.id, estado="activo"))
    db.add(ClientPlan(cliente_id=c2.id, plan_id=plan.id, estado="activo"))
    db.flush()

    base = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    peak = datetime(2026, 3, 1, 20, 0, tzinfo=timezone.utc)
    db.add(TrafficSample(id=uuid.uuid4(), router_id=router.id, client_id=c1.id, rx_delta_bytes=1000, tx_delta_bytes=1000, timestamp=base))
    db.add(TrafficSample(id=uuid.uuid4(), router_id=router.id, client_id=c1.id, rx_delta_bytes=5000, tx_delta_bytes=5000, timestamp=peak))
    db.add(TrafficSample(id=uuid.uuid4(), router_id=router.id, client_id=c2.id, rx_delta_bytes=100, tx_delta_bytes=100, timestamp=base))
    db.commit()

    report = get_consumption_report(
        db, datetime(2026, 3, 1, tzinfo=timezone.utc), datetime(2026, 3, 2, tzinfo=timezone.utc), limit=5
    )
    assert report.top_consumers[0].client_name == "Cliente Grande"
    assert report.top_consumers[0].total_bytes == 12000
    assert report.top_consumers[0].plan_name == "Plan A"
    assert report.peak_hours[0].hour == 20
    assert report.peak_hours[0].total_bytes == 10000
    assert report.by_plan[0].plan_name == "Plan A"
    assert report.by_plan[0].clients_count == 2
    db.close()


# ── Reporte de mora ────────────────────────────────────────────────────────────
def test_overdue_report_computes_days_overdue_and_totals():
    db = TestingSessionLocal()
    router = Router(name="R1", ip="10.0.0.1", api_port=8728, api_username="a", password_enc="x")
    db.add(router)
    db.flush()
    plan = Plan(name="Plan A", speed_down_mbps=10, speed_up_mbps=5, price=20.0)
    db.add(plan)
    db.flush()
    c1 = _client(db, router, "Moroso Uno", "1710000030")
    c2 = _client(db, router, "Moroso Dos", "1710000031")
    db.add(Invoice(
        client_id=c1.id, plan_id=plan.id, period="01/2026", amount=20.0,
        due_date=datetime.now(timezone.utc) - timedelta(days=10), status="overdue",
    ))
    db.add(Invoice(
        client_id=c2.id, plan_id=plan.id, period="02/2026", amount=30.0,
        due_date=datetime.now(timezone.utc) - timedelta(days=3), status="overdue",
    ))
    db.add(Invoice(
        client_id=c1.id, plan_id=plan.id, period="02/2026", amount=20.0,
        due_date=datetime.now(timezone.utc) + timedelta(days=5), status="pending",
    ))
    db.commit()

    report = get_overdue_report(db)
    assert report.total_invoices == 2
    assert report.total_clients == 2
    assert report.total_amount == 50.0
    assert report.items[0].days_overdue >= 9  # el más antiguo primero (due_date asc)
    db.close()


# ── API ──────────────────────────────────────────────────────────────────────
def test_reports_endpoints_require_auth(client: TestClient):
    for path in ("/api/reports/revenue", "/api/reports/clients", "/api/reports/consumption", "/api/reports/overdue"):
        assert client.get(path).status_code == 401


def test_reports_json_endpoints_return_200(client: TestClient):
    headers = {"Authorization": f"Bearer {_token(client)}"}
    assert client.get("/api/reports/revenue", headers=headers).status_code == 200
    assert client.get("/api/reports/clients", headers=headers).status_code == 200
    assert client.get("/api/reports/consumption", headers=headers).status_code == 200
    assert client.get("/api/reports/overdue", headers=headers).status_code == 200


def test_reports_rejects_invalid_group_by_at_api_level(client: TestClient):
    headers = {"Authorization": f"Bearer {_token(client)}"}
    r = client.get("/api/reports/revenue?group_by=week", headers=headers)
    assert r.status_code == 422


@pytest.mark.parametrize("report", ["revenue", "clients", "consumption", "overdue"])
def test_reports_pdf_export(client: TestClient, report: str):
    headers = {"Authorization": f"Bearer {_token(client)}"}
    r = client.get(f"/api/reports/{report}/pdf", headers=headers)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"


@pytest.mark.parametrize("report", ["revenue", "clients", "consumption", "overdue"])
def test_reports_excel_export(client: TestClient, report: str):
    headers = {"Authorization": f"Bearer {_token(client)}"}
    r = client.get(f"/api/reports/{report}/excel", headers=headers)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert len(r.content) > 0


def test_date_from_after_date_to_is_rejected(client: TestClient):
    headers = {"Authorization": f"Bearer {_token(client)}"}
    r = client.get("/api/reports/revenue?date_from=2026-06-01&date_to=2026-01-01", headers=headers)
    assert r.status_code == 400
