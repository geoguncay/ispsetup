"""
Agregados del dashboard.

Todo se calcula con COUNT/SUM/GROUP BY en la base de datos; el estado de routers y
balanceadores llega ya resuelto (health check cacheado en Redis) desde la capa API.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.inventory import InventoryItem
from app.models.invoice import Invoice
from app.models.load_balancer import LoadBalancer
from app.models.map_topology import MapAccessPoint, MapLink
from app.models.payment import ClientPayment
from app.models.router import Router
from app.models.suspension_log import SuspensionLog
from app.services.audit_service import AuditAction
from app.schemas.dashboard import (
    ActivityFeed,
    ActivityItem,
    ClientsSummary,
    DashboardAlert,
    FinanceSummary,
    MapPoint,
    NetworkSummary,
    RevenueTrend,
    RevenueTrendPoint,
    StatusCounts,
)

KNOWN_STATUSES = ("online", "offline", "tunnel_down", "degraded")
CLIENT_MEDIA = ("radio", "fiber", "unspecified")
CLIENT_ACCESS_METHODS = ("static", "pppoe")
# Solo cuentan los pagos efectivamente cobrados, igual que el reporte de ingresos.
PAYMENT_OK = "completed"
# Ruido de sesión: no aporta al feed de actividad operativa.
ACTIVITY_EXCLUDED_ACTIONS = (AuditAction.USER_LOGIN, AuditAction.USER_LOGIN_FAILED, AuditAction.USER_LOGOUT)


def now_local() -> datetime:
    """Ahora con la zona horaria del servidor (los límites de 'hoy'/'mes' son locales)."""
    return datetime.now().astimezone()


def month_start(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def shift_month(dt: datetime, delta: int) -> datetime:
    """Primer día del mes `delta` meses antes/después de `dt` (dt debe ser día 1)."""
    index = dt.year * 12 + (dt.month - 1) + delta
    return dt.replace(year=index // 12, month=index % 12 + 1, day=1)


def count_statuses(statuses: list[str | None]) -> StatusCounts:
    counter = Counter(s if s in KNOWN_STATUSES else "unknown" for s in statuses)
    return StatusCounts(
        total=len(statuses),
        online=counter["online"],
        offline=counter["offline"],
        tunnel_down=counter["tunnel_down"],
        degraded=counter["degraded"],
        unknown=counter["unknown"],
    )


def _sum_payments(db: Session, start: datetime, end: datetime) -> tuple[float, int]:
    total, count = (
        db.query(func.coalesce(func.sum(ClientPayment.amount), 0), func.count(ClientPayment.id))
        .filter(ClientPayment.status == PAYMENT_OK)
        .filter(ClientPayment.payment_date >= start, ClientPayment.payment_date < end)
        .one()
    )
    return round(float(total), 2), int(count)


def get_clients_summary(db: Session, now: datetime) -> ClientsSummary:
    total, active, scheduled, pending_plan, without_location = db.query(
        func.count(Client.id),
        func.coalesce(func.sum(case((Client.active.is_(True), 1), else_=0)), 0),
        func.count(Client.scheduled_suspension),
        func.count(Client.pending_plan_id),
        func.coalesce(
            func.sum(case(((Client.latitude.is_(None)) | (Client.longitude.is_(None)), 1), else_=0)),
            0,
        ),
    ).one()
    total, active = int(total), int(active)

    by_medium = {k: 0 for k in CLIENT_MEDIA}
    for medium, n in db.query(Client.medium, func.count(Client.id)).group_by(Client.medium).all():
        by_medium[medium if medium in by_medium else "unspecified"] += n

    by_access = {k: 0 for k in CLIENT_ACCESS_METHODS}
    for method, n in db.query(Client.access_method, func.count(Client.id)).group_by(Client.access_method).all():
        by_access[method] = by_access.get(method, 0) + n

    return ClientsSummary(
        total=total,
        active=active,
        suspended=total - active,
        scheduled_suspensions=int(scheduled),
        pending_plan_changes=int(pending_plan),
        by_medium=by_medium,
        by_access_method=by_access,
        without_location=int(without_location),
    )


def get_finance_summary(db: Session, now: datetime) -> FinanceSummary:
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    this_month = month_start(now)
    prev_month = shift_month(this_month, -1)
    next_month = shift_month(this_month, 1)

    collected_today, _ = _sum_payments(db, today, today + timedelta(days=1))
    collected_month, _ = _sum_payments(db, this_month, next_month)
    collected_prev, _ = _sum_payments(db, prev_month, this_month)

    def invoice_totals(status: str) -> tuple[int, float, int]:
        n, amount, clients = (
            db.query(
                func.count(Invoice.id),
                func.coalesce(func.sum(Invoice.amount), 0),
                func.count(func.distinct(Invoice.client_id)),
            )
            .filter(Invoice.status == status)
            .one()
        )
        return int(n), round(float(amount), 2), int(clients)

    pending_n, pending_amount, _c = invoice_totals("pending")
    overdue_n, overdue_amount, overdue_clients = invoice_totals("overdue")

    return FinanceSummary(
        collected_today=collected_today,
        collected_month=collected_month,
        collected_previous_month=collected_prev,
        pending_invoices=pending_n,
        pending_amount=pending_amount,
        overdue_invoices=overdue_n,
        overdue_amount=overdue_amount,
        overdue_clients=overdue_clients,
    )


def get_network_summary(db: Session) -> NetworkSummary:
    roles = dict(
        db.query(MapAccessPoint.role, func.count(MapAccessPoint.id)).group_by(MapAccessPoint.role).all()
    )
    kinds = dict(db.query(MapLink.kind, func.count(MapLink.id)).group_by(MapLink.kind).all())
    return NetworkSummary(
        access_points=int(roles.get("ap", 0)),
        stations=int(roles.get("station", 0)),
        ptp_links=int(kinds.get("ptp", 0)),
        ptmp_links=int(kinds.get("ap", 0)),
    )


def get_map_points(
    db: Session,
    router_status: dict[str, str],
    lb_status: dict[str, str],
) -> list[MapPoint]:
    """Routers, balanceadores, APs y estaciones con coordenadas (los clientes no se incluyen)."""
    points: list[MapPoint] = []
    for r in db.query(Router).filter(Router.active.is_(True), Router.latitude.isnot(None), Router.longitude.isnot(None)):
        points.append(MapPoint(
            id=r.id, name=r.name, latitude=r.latitude, longitude=r.longitude,
            kind="router", status=router_status.get(str(r.id), "unknown"),
        ))
    for lb in db.query(LoadBalancer).filter(
        LoadBalancer.active.is_(True), LoadBalancer.latitude.isnot(None), LoadBalancer.longitude.isnot(None)
    ):
        points.append(MapPoint(
            id=lb.id, name=lb.name, latitude=lb.latitude, longitude=lb.longitude,
            kind="load_balancer", status=lb_status.get(str(lb.id), "unknown"),
        ))
    for ap in db.query(MapAccessPoint):
        points.append(MapPoint(
            id=ap.id, name=ap.name, latitude=ap.latitude, longitude=ap.longitude,
            kind="station" if ap.role == "station" else "ap",
        ))
    return points


def build_alerts(
    db: Session,
    infra_routers: StatusCounts,
    infra_lbs: StatusCounts,
    clients: ClientsSummary,
    finance: FinanceSummary | None,
    now: datetime,
) -> list[DashboardAlert]:
    alerts: list[DashboardAlert] = []

    routers_down = infra_routers.offline + infra_routers.tunnel_down
    if routers_down:
        alerts.append(DashboardAlert(
            code="routers_down", severity="critical", title="Routers sin conexión",
            count=routers_down,
            detail=f"{infra_routers.offline} sin respuesta, {infra_routers.tunnel_down} con túnel caído",
            link="/routers",
        ))
    lbs_down = infra_lbs.offline + infra_lbs.tunnel_down
    if lbs_down:
        alerts.append(DashboardAlert(
            code="load_balancers_down", severity="critical", title="Balanceadores sin conexión",
            count=lbs_down, link="/load-balancers",
        ))
    if finance and finance.overdue_invoices:
        alerts.append(DashboardAlert(
            code="overdue_invoices", severity="warning", title="Facturas vencidas",
            count=finance.overdue_invoices,
            detail=f"{finance.overdue_clients} clientes en mora por ${finance.overdue_amount:,.2f}",
            link="/reports/overdue",
        ))

    low_stock = (
        db.query(func.count(InventoryItem.id))
        .filter(InventoryItem.quantity <= InventoryItem.min_alert)
        .scalar()
    )
    if low_stock:
        alerts.append(DashboardAlert(
            code="low_stock", severity="warning", title="Stock bajo en inventario",
            count=int(low_stock), link="/inventory",
        ))

    due_suspensions = (
        db.query(func.count(Client.id))
        .filter(Client.active.is_(True), Client.scheduled_suspension.isnot(None), Client.scheduled_suspension <= now)
        .scalar()
    )
    if due_suspensions:
        alerts.append(DashboardAlert(
            code="suspensions_due", severity="info", title="Suspensiones programadas por ejecutar",
            count=int(due_suspensions), link="/clients",
        ))
    if clients.without_location:
        alerts.append(DashboardAlert(
            code="clients_without_location", severity="info", title="Clientes sin ubicación en el mapa",
            count=clients.without_location, link="/clients",
        ))
    return alerts


def get_revenue_trend(db: Session, months: int, now: datetime) -> RevenueTrend:
    first = shift_month(month_start(now), -(months - 1))
    points: list[RevenueTrendPoint] = []
    for i in range(months):
        start = shift_month(first, i)
        amount, count = _sum_payments(db, start, shift_month(start, 1))
        points.append(RevenueTrendPoint(label=start.strftime("%Y-%m"), amount=amount, payments_count=count))
    return RevenueTrend(points=points)


def get_activity(db: Session, include_audit: bool, limit: int) -> ActivityFeed:
    """
    Admin: últimas acciones auditadas. Resto de roles: solo suspensiones/reactivaciones
    (el registro de auditoría es exclusivo de admin).
    """
    items: list[ActivityItem] = []
    if include_audit:
        rows = (
            db.query(AuditLog)
            .filter(AuditLog.action.notin_(ACTIVITY_EXCLUDED_ACTIONS))
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
            .all()
        )
        for row in rows:
            summary = row.detail.get("summary") if isinstance(row.detail, dict) else None
            items.append(ActivityItem(
                id=str(row.id), kind="audit", action=row.action,
                title=summary or row.action, entity_type=row.entity_type,
                entity_name=row.entity_name, user_name=row.user_name, created_at=row.created_at,
            ))
        return ActivityFeed(items=items)

    logs = (
        db.query(SuspensionLog, Client.full_name)
        .join(Client, SuspensionLog.client_id == Client.id)
        .order_by(func.coalesce(SuspensionLog.reactivated_at, SuspensionLog.suspended_at).desc())
        .limit(limit)
        .all()
    )
    for log, client_name in logs:
        reactivated = log.reactivated_at is not None
        items.append(ActivityItem(
            id=str(log.id),
            kind="reactivation" if reactivated else "suspension",
            action="CLIENT_REACTIVATE" if reactivated else "CLIENT_SUSPEND",
            title="Cliente reactivado" if reactivated else f"Cliente suspendido: {log.reason}",
            entity_type="Client", entity_name=client_name, user_name=log.user_name,
            created_at=log.reactivated_at or log.suspended_at,
        ))
    return ActivityFeed(items=items)
