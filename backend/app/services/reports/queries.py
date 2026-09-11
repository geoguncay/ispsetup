"""
Consultas de agregación para el módulo de Reportes (Fase 4.3).

Ingresos y clientes se agregan en Python (tablas de escala "evento de negocio":
pagos, altas, suspensiones — miles de filas como mucho). Consumo se agrega en
SQL (tabla `traffic_samples`, escala telemetría — puede tener millones de filas
en un rango de 30 días) para no traer la tabla completa a memoria.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.invoice import Invoice
from app.models.payment import ClientPayment
from app.models.plan import Plan
from app.models.router import Router
from app.models.site import Site
from app.models.suspension_log import SuspensionLog
from app.models.traffic_sample import TrafficSample
from app.schemas.reports import (
    ClientsMonthPoint,
    ClientsReport,
    ConsumptionReport,
    OverdueInvoicePoint,
    OverdueReport,
    PeakHourPoint,
    PlanAveragePoint,
    RevenueByPlan,
    RevenueBySite,
    RevenuePeriodPoint,
    RevenueReport,
    TopConsumerPoint,
)

GROUP_BY_VALUES = ("month", "quarter", "year")


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite no aplica tz aunque la columna sea DateTime(timezone=True); asume UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _period_label(dt: datetime, group_by: str) -> str:
    if group_by == "year":
        return f"{dt.year}"
    if group_by == "quarter":
        quarter = (dt.month - 1) // 3 + 1
        return f"{dt.year}-Q{quarter}"
    return f"{dt.year}-{dt.month:02d}"


def _next_month(dt: datetime) -> datetime:
    if dt.month == 12:
        return dt.replace(year=dt.year + 1, month=1)
    return dt.replace(month=dt.month + 1)


def _month_labels_between(date_from: datetime, date_to: datetime) -> list[str]:
    """Todas las etiquetas 'YYYY-MM' entre date_from y date_to (para no dejar huecos en la evolución)."""
    labels = []
    cursor = date_from.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = date_to
    while cursor <= end:
        labels.append(f"{cursor.year}-{cursor.month:02d}")
        cursor = _next_month(cursor)
    return labels


# ── Reporte de ingresos ──────────────────────────────────────────────────────
def get_revenue_report(
    db: Session, group_by: str, date_from: datetime, date_to: datetime
) -> RevenueReport:
    if group_by not in GROUP_BY_VALUES:
        raise ValueError(f"group_by debe ser uno de {GROUP_BY_VALUES}")

    rows = (
        db.query(
            ClientPayment.amount,
            ClientPayment.payment_date,
            Invoice.plan_id,
            Plan.name,
            Router.site_id,
            Site.name,
        )
        .filter(ClientPayment.status == "completed")
        .filter(ClientPayment.payment_date >= date_from, ClientPayment.payment_date <= date_to)
        .outerjoin(Invoice, ClientPayment.invoice_id == Invoice.id)
        .outerjoin(Plan, Invoice.plan_id == Plan.id)
        .outerjoin(Client, ClientPayment.client_id == Client.id)
        .outerjoin(Router, Client.router_id == Router.id)
        .outerjoin(Site, Router.site_id == Site.id)
        .all()
    )

    period_buckets: dict[str, dict[str, float | int]] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    plan_buckets: dict[str, dict] = defaultdict(lambda: {"plan_id": None, "amount": 0.0, "count": 0})
    site_buckets: dict[str, dict] = defaultdict(lambda: {"site_id": None, "amount": 0.0, "count": 0})

    total_amount = 0.0
    for amount, payment_date, plan_id, plan_name, site_id, site_name in rows:
        amount = float(amount)
        total_amount += amount

        label = _period_label(payment_date, group_by)
        period_buckets[label]["amount"] += amount
        period_buckets[label]["count"] += 1

        plan_key = plan_name or "Sin plan / cargo directo"
        plan_buckets[plan_key]["plan_id"] = plan_id
        plan_buckets[plan_key]["amount"] += amount
        plan_buckets[plan_key]["count"] += 1

        site_key = site_name or "Sin sitio"
        site_buckets[site_key]["site_id"] = site_id
        site_buckets[site_key]["amount"] += amount
        site_buckets[site_key]["count"] += 1

    by_period = [
        RevenuePeriodPoint(label=label, amount=round(v["amount"], 2), payments_count=v["count"])
        for label, v in sorted(period_buckets.items())
    ]
    by_plan = [
        RevenueByPlan(plan_id=v["plan_id"], plan_name=name, amount=round(v["amount"], 2), payments_count=v["count"])
        for name, v in sorted(plan_buckets.items(), key=lambda kv: kv[1]["amount"], reverse=True)
    ]
    by_site = [
        RevenueBySite(site_id=v["site_id"], site_name=name, amount=round(v["amount"], 2), payments_count=v["count"])
        for name, v in sorted(site_buckets.items(), key=lambda kv: kv[1]["amount"], reverse=True)
    ]

    return RevenueReport(
        date_from=date_from,
        date_to=date_to,
        group_by=group_by,
        total_amount=round(total_amount, 2),
        total_payments=len(rows),
        by_period=by_period,
        by_plan=by_plan,
        by_site=by_site,
    )


# ── Reporte de clientes ───────────────────────────────────────────────────────
def get_clients_report(db: Session, date_from: datetime, date_to: datetime) -> ClientsReport:
    total_clients = db.query(func.count(Client.id)).scalar() or 0
    active_clients = db.query(func.count(Client.id)).filter(Client.active.is_(True)).scalar() or 0
    suspended_clients = total_clients - active_clients

    new_rows = (
        db.query(Client.created_at)
        .filter(Client.created_at >= date_from, Client.created_at <= date_to)
        .all()
    )
    suspension_rows = (
        db.query(SuspensionLog.suspended_at)
        .filter(SuspensionLog.suspended_at >= date_from, SuspensionLog.suspended_at <= date_to)
        .all()
    )
    # "Bajas": planes cancelados en el mes. No existe un evento formal de "cliente dado de
    # baja" separado de la suspensión — se usa ClientPlan.estado == "cancelado" como proxy.
    churn_rows = (
        db.query(ClientPlan.fecha_fin)
        .filter(ClientPlan.estado == "cancelado")
        .filter(ClientPlan.fecha_fin.isnot(None))
        .filter(ClientPlan.fecha_fin >= date_from, ClientPlan.fecha_fin <= date_to)
        .all()
    )

    buckets: dict[str, dict[str, int]] = {
        label: {"new": 0, "suspended": 0, "churned": 0}
        for label in _month_labels_between(date_from, date_to)
    }
    for (dt,) in new_rows:
        buckets.setdefault(_period_label(dt, "month"), {"new": 0, "suspended": 0, "churned": 0})["new"] += 1
    for (dt,) in suspension_rows:
        buckets.setdefault(_period_label(dt, "month"), {"new": 0, "suspended": 0, "churned": 0})["suspended"] += 1
    for (dt,) in churn_rows:
        buckets.setdefault(_period_label(dt, "month"), {"new": 0, "suspended": 0, "churned": 0})["churned"] += 1

    evolution = [
        ClientsMonthPoint(
            label=label, new_clients=v["new"], suspended_events=v["suspended"], churned_clients=v["churned"]
        )
        for label, v in sorted(buckets.items())
    ]

    return ClientsReport(
        date_from=date_from,
        date_to=date_to,
        total_clients=total_clients,
        active_clients=active_clients,
        suspended_clients=suspended_clients,
        evolution=evolution,
    )


# ── Reporte de consumo ────────────────────────────────────────────────────────
def get_consumption_report(
    db: Session, date_from: datetime, date_to: datetime, limit: int = 10
) -> ConsumptionReport:
    total_expr = func.sum(TrafficSample.rx_delta_bytes + TrafficSample.tx_delta_bytes)

    top_rows = (
        db.query(TrafficSample.client_id, total_expr.label("total_bytes"))
        .filter(TrafficSample.timestamp >= date_from, TrafficSample.timestamp <= date_to)
        .filter(TrafficSample.client_id.isnot(None))
        .group_by(TrafficSample.client_id)
        .order_by(total_expr.desc())
        .limit(limit)
        .all()
    )
    client_ids = [row.client_id for row in top_rows]
    names_and_plans: dict = {}
    if client_ids:
        client_rows = (
            db.query(Client.id, Client.full_name, Plan.name)
            .outerjoin(ClientPlan, (ClientPlan.cliente_id == Client.id) & (ClientPlan.estado == "activo"))
            .outerjoin(Plan, Plan.id == ClientPlan.plan_id)
            .filter(Client.id.in_(client_ids))
            .all()
        )
        names_and_plans = {cid: (name, plan_name) for cid, name, plan_name in client_rows}

    top_consumers = [
        TopConsumerPoint(
            client_id=row.client_id,
            client_name=names_and_plans.get(row.client_id, ("Cliente eliminado", None))[0],
            plan_name=names_and_plans.get(row.client_id, (None, None))[1],
            total_bytes=int(row.total_bytes or 0),
        )
        for row in top_rows
    ]

    plan_total_expr = func.sum(TrafficSample.rx_delta_bytes + TrafficSample.tx_delta_bytes)
    plan_rows = (
        db.query(
            ClientPlan.plan_id,
            Plan.name,
            plan_total_expr.label("total_bytes"),
            func.count(func.distinct(TrafficSample.client_id)),
        )
        .select_from(TrafficSample)
        .join(ClientPlan, ClientPlan.cliente_id == TrafficSample.client_id)
        .join(Plan, Plan.id == ClientPlan.plan_id)
        .filter(ClientPlan.estado == "activo")
        .filter(TrafficSample.timestamp >= date_from, TrafficSample.timestamp <= date_to)
        .group_by(ClientPlan.plan_id, Plan.name)
        .all()
    )
    by_plan = [
        PlanAveragePoint(
            plan_id=plan_id,
            plan_name=name,
            avg_bytes_per_client=int((total_bytes or 0) / clients_count) if clients_count else 0,
            clients_count=clients_count,
        )
        for plan_id, name, total_bytes, clients_count in plan_rows
    ]
    by_plan.sort(key=lambda p: p.avg_bytes_per_client, reverse=True)

    hour_expr = func.extract("hour", TrafficSample.timestamp)
    hour_total_expr = func.sum(TrafficSample.rx_delta_bytes + TrafficSample.tx_delta_bytes)
    hour_rows = (
        db.query(hour_expr.label("hour"), hour_total_expr.label("total_bytes"))
        .filter(TrafficSample.timestamp >= date_from, TrafficSample.timestamp <= date_to)
        .group_by(hour_expr)
        .order_by(hour_total_expr.desc())
        .all()
    )
    peak_hours = [
        PeakHourPoint(hour=int(row.hour), total_bytes=int(row.total_bytes or 0)) for row in hour_rows
    ]

    return ConsumptionReport(
        date_from=date_from, date_to=date_to, top_consumers=top_consumers, by_plan=by_plan, peak_hours=peak_hours
    )


# ── Reporte de mora ────────────────────────────────────────────────────────────
def get_overdue_report(db: Session) -> OverdueReport:
    now = datetime.now(timezone.utc)
    rows = (
        db.query(Invoice, Client, Plan)
        .join(Client, Invoice.client_id == Client.id)
        .outerjoin(Plan, Invoice.plan_id == Plan.id)
        .filter(Invoice.status == "overdue")
        .order_by(Invoice.due_date.asc())
        .all()
    )

    items: list[OverdueInvoicePoint] = []
    total_amount = 0.0
    client_ids: set = set()
    for invoice, client, plan in rows:
        due_date = _aware(invoice.due_date)
        days_overdue = max((now - due_date).days, 0)
        amount = float(invoice.amount)
        items.append(
            OverdueInvoicePoint(
                invoice_id=invoice.id,
                client_id=client.id,
                client_name=client.full_name,
                plan_name=plan.name if plan else None,
                period=invoice.period,
                due_date=invoice.due_date,
                days_overdue=days_overdue,
                amount=amount,
            )
        )
        total_amount += amount
        client_ids.add(client.id)

    return OverdueReport(
        generated_at=now,
        total_amount=round(total_amount, 2),
        total_invoices=len(items),
        total_clients=len(client_ids),
        items=items,
    )
