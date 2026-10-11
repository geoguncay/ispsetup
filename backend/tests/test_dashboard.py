"""Tests del dashboard: resumen agregado, permisos por rol, tendencia y actividad."""
from datetime import datetime, timedelta
from types import SimpleNamespace
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
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.inventory import InventoryItem
from app.models.invoice import Invoice
from app.models.map_topology import MapAccessPoint, MapLink
from app.models.payment import ClientPayment
from app.models.router import Router
from app.models.suspension_log import SuspensionLog
from app.models.user import User
from app.services.dashboard import count_statuses, month_start, now_local, shift_month

engine_test = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test)

# router_id → estado devuelto por el health check cacheado (por defecto "online").
ROUTER_STATUSES: dict[str, str] = {}


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


async def _fake_router_status(router_id: str):
    return SimpleNamespace(status=ROUTER_STATUSES.get(router_id, "online"))


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setattr(db_module, "engine", engine_test)
    monkeypatch.setattr(db_module, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr("app.api.auth.redis_client", AsyncMock())
    monkeypatch.setattr("app.api.dashboard_api.get_cached_router_status", _fake_router_status)
    monkeypatch.setattr("app.api.dashboard_api.get_cached_load_balancer_status", AsyncMock(return_value=None))
    ROUTER_STATUSES.clear()
    Base.metadata.create_all(bind=engine_test)

    db = TestingSessionLocal()
    for name, email, role in (
        ("Admin", "admin@test.com", "admin"),
        ("Tecnico", "tech@test.com", "technician"),
        ("Visor", "viewer@test.com", "viewer"),
    ):
        db.add(User(name=name, email=email, hashed_password=hash_password("password123"), role=role, active=True))
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


def _headers(client: TestClient, email: str) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed() -> str:
    """Crea datos de ejemplo y devuelve el id del router caído."""
    db = TestingSessionLocal()
    r_ok = Router(name="R-ok", ip="10.0.0.1", api_port=8728, api_username="a", password_enc="x",
                  latitude=-0.2, longitude=-78.5)
    r_down = Router(name="R-down", ip="10.0.0.2", api_port=8728, api_username="a", password_enc="x")
    db.add_all([r_ok, r_down])
    db.flush()

    def mk(name, cedula, **kw):
        c = Client(full_name=name, cedula=cedula, address="Quito", router_id=r_ok.id, **kw)
        db.add(c)
        db.flush()
        return c

    c1 = mk("Uno", "1710000001", access_method="static", medium="radio", latitude=-0.2, longitude=-78.5)
    c2 = mk("Dos", "1710000002", access_method="pppoe", medium="fiber", latitude=-0.3, longitude=-78.4)
    c3 = mk("Tres", "1710000003", access_method="static", medium="unspecified", active=False)

    now = now_local()
    inv_paid = Invoice(client_id=c1.id, period="01/2026", amount=30.0, due_date=now, status="paid")
    inv_over = Invoice(client_id=c3.id, period="01/2026", amount=25.0, due_date=now - timedelta(days=5), status="overdue")
    inv_pend = Invoice(client_id=c2.id, period="02/2026", amount=40.0, due_date=now + timedelta(days=5), status="pending")
    db.add_all([inv_paid, inv_over, inv_pend])
    db.flush()
    db.add(ClientPayment(client_id=c1.id, invoice_id=inv_paid.id, amount=30.0, payment_date=now,
                         method="cash", status="completed"))
    # Anulado: no cuenta como recaudado.
    db.add(ClientPayment(client_id=c1.id, amount=99.0, payment_date=now, method="cash", status="cancelled"))
    prev = shift_month(month_start(now), -1) + timedelta(days=3)
    db.add(ClientPayment(client_id=c2.id, amount=50.0, payment_date=prev, method="card", status="completed"))

    ap = MapAccessPoint(name="AP1", latitude=-0.2, longitude=-78.5, role="ap")
    db.add(ap)
    db.add(MapAccessPoint(name="ST1", latitude=-0.21, longitude=-78.51, role="station"))
    db.flush()
    db.add(MapLink(kind="ptp", source_type="ap", source_id=ap.id, target_type="router", target_id=r_ok.id))
    db.add(MapLink(kind="ap", source_type="ap", source_id=ap.id, target_type="client", target_id=c1.id))

    db.add(InventoryItem(name="CPE", code="CPE-1", quantity=2, min_alert=5))
    db.add(InventoryItem(name="Cable", code="CAB-1", quantity=100, min_alert=5))
    db.commit()
    down_id = str(r_down.id)
    db.close()
    return down_id


# ── Unidades ─────────────────────────────────────────────────────────────────
def test_count_statuses_maps_unknown_and_missing():
    counts = count_statuses(["online", "online", "offline", "tunnel_down", "degraded", None, "weird"])
    assert (counts.total, counts.online, counts.offline) == (7, 2, 1)
    assert (counts.tunnel_down, counts.degraded, counts.unknown) == (1, 1, 2)
    # La suma de estados siempre cuadra con el total.
    assert counts.online + counts.offline + counts.tunnel_down + counts.degraded + counts.unknown == counts.total


def test_shift_month_crosses_year_boundary():
    jan = datetime(2026, 1, 1)
    assert shift_month(jan, -1) == datetime(2025, 12, 1)
    assert shift_month(datetime(2025, 12, 1), 1) == jan


# ── Resumen ──────────────────────────────────────────────────────────────────
def test_summary_admin_has_finance_and_alerts(client):
    ROUTER_STATUSES[_seed()] = "offline"

    r = client.get("/api/dashboard/summary", headers=_headers(client, "admin@test.com"))
    assert r.status_code == 200
    body = r.json()

    assert body["infra"]["routers"] == {
        "total": 2, "online": 1, "offline": 1, "tunnel_down": 0, "degraded": 0, "unknown": 0,
    }
    c = body["clients"]
    assert (c["total"], c["active"], c["suspended"]) == (3, 2, 1)
    assert c["by_medium"] == {"radio": 1, "fiber": 1, "unspecified": 1}
    assert c["by_access_method"] == {"static": 2, "pppoe": 1}
    assert c["without_location"] == 1

    f = body["finance"]
    assert f["collected_today"] == 30.0
    assert f["collected_month"] == 30.0
    assert f["collected_previous_month"] == 50.0
    assert (f["pending_invoices"], f["pending_amount"]) == (1, 40.0)
    assert (f["overdue_invoices"], f["overdue_amount"], f["overdue_clients"]) == (1, 25.0, 1)

    assert body["network"] == {"access_points": 1, "stations": 1, "ptp_links": 1, "ptmp_links": 1}

    alerts = {a["code"]: a for a in body["alerts"]}
    assert alerts["routers_down"]["severity"] == "critical" and alerts["routers_down"]["count"] == 1
    assert alerts["overdue_invoices"]["count"] == 1
    assert alerts["low_stock"]["count"] == 1
    assert alerts["clients_without_location"]["count"] == 1

    # R-down no tiene coordenadas, así que no aparece en el mapa.
    assert sorted(p["kind"] for p in body["map_points"]) == ["ap", "router", "station"]


@pytest.mark.parametrize("email", ["tech@test.com", "viewer@test.com"])
def test_summary_hides_finance_for_non_admin(client, email):
    _seed()
    r = client.get("/api/dashboard/summary", headers=_headers(client, email))
    assert r.status_code == 200
    body = r.json()
    assert body["finance"] is None
    assert "overdue_invoices" not in {a["code"] for a in body["alerts"]}
    assert body["clients"]["total"] == 3


def test_summary_requires_auth(client):
    assert client.get("/api/dashboard/summary").status_code in (401, 403)


def test_summary_empty_database(client):
    r = client.get("/api/dashboard/summary", headers=_headers(client, "admin@test.com"))
    assert r.status_code == 200
    body = r.json()
    assert body["infra"]["routers"]["total"] == 0
    assert body["clients"]["total"] == 0 and body["clients"]["by_medium"]["radio"] == 0
    assert body["finance"]["collected_month"] == 0
    assert body["alerts"] == [] and body["map_points"] == []


# ── Tendencia ────────────────────────────────────────────────────────────────
def test_revenue_trend_returns_requested_months_in_order(client):
    _seed()
    r = client.get("/api/dashboard/revenue-trend?months=3", headers=_headers(client, "admin@test.com"))
    assert r.status_code == 200
    points = r.json()["points"]
    now = now_local()
    assert [p["label"] for p in points] == [
        shift_month(month_start(now), -2).strftime("%Y-%m"),
        shift_month(month_start(now), -1).strftime("%Y-%m"),
        now.strftime("%Y-%m"),
    ]
    assert (points[1]["amount"], points[1]["payments_count"]) == (50.0, 1)
    assert (points[2]["amount"], points[2]["payments_count"]) == (30.0, 1)


def test_revenue_trend_admin_only(client):
    for email in ("tech@test.com", "viewer@test.com"):
        r = client.get("/api/dashboard/revenue-trend", headers=_headers(client, email))
        assert r.status_code == 403


def test_revenue_trend_validates_months(client):
    h = _headers(client, "admin@test.com")
    assert client.get("/api/dashboard/revenue-trend?months=0", headers=h).status_code == 422
    assert client.get("/api/dashboard/revenue-trend?months=25", headers=h).status_code == 422


# ── Actividad ────────────────────────────────────────────────────────────────
def test_activity_admin_reads_audit_log_non_admin_reads_suspensions(client):
    db = TestingSessionLocal()
    router = Router(name="R", ip="10.0.0.1", api_port=8728, api_username="a", password_enc="x")
    db.add(router)
    db.flush()
    c = Client(full_name="Cliente", cedula="1710000009", address="Quito", router_id=router.id)
    db.add(c)
    db.flush()
    db.add(AuditLog(action="PAYMENT_CREATE", entity_type="Payment", entity_id="1",
                    entity_name="Pago · Cliente", user_name="Admin", detail={"summary": "Pago registrado"}))
    db.add(SuspensionLog(client_id=c.id, reason="Mora", suspended_at=now_local()))
    db.commit()
    db.close()

    admin = client.get("/api/dashboard/activity", headers=_headers(client, "admin@test.com")).json()
    assert [i["title"] for i in admin["items"]] == ["Pago registrado"]
    assert admin["items"][0]["kind"] == "audit"

    tech = client.get("/api/dashboard/activity", headers=_headers(client, "tech@test.com")).json()
    assert len(tech["items"]) == 1
    assert tech["items"][0]["kind"] == "suspension"
    assert tech["items"][0]["entity_name"] == "Cliente"
