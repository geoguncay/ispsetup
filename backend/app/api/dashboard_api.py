"""
Endpoints del dashboard principal: resumen agregado, tendencia de ingresos y actividad.

Los bloques financieros son exclusivos de admin; el resto de roles recibe `finance = null`.
"""
import asyncio
from datetime import datetime

from fastapi import APIRouter, Query

from app.core.deps import AdminOnly, CurrentUser, DBSession
from app.models.load_balancer import LoadBalancer
from app.models.router import Router
from app.schemas.dashboard import (
    ActivityFeed,
    DashboardSummary,
    InfraSummary,
    RevenueTrend,
)
from app.services import dashboard as svc
from app.services.load_balancer.health import get_cached_load_balancer_status
from app.services.router.health import get_cached_router_status

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


async def _statuses(items: list, fetch) -> dict[str, str]:
    """{id: status} leyendo el health check cacheado; sin caché → 'unknown'."""
    cached = await asyncio.gather(*(fetch(str(i.id)) for i in items))
    return {str(i.id): (c.status if c else "unknown") for i, c in zip(items, cached)}


@router.get("/summary", response_model=DashboardSummary)
async def get_summary(db: DBSession, current_user: CurrentUser) -> DashboardSummary:
    now = svc.now_local()

    routers = db.query(Router).filter(Router.active.is_(True)).all()
    lbs = db.query(LoadBalancer).filter(LoadBalancer.active.is_(True)).all()
    router_status = await _statuses(routers, get_cached_router_status)
    lb_status = await _statuses(lbs, get_cached_load_balancer_status)

    infra = InfraSummary(
        routers=svc.count_statuses(list(router_status.values())),
        load_balancers=svc.count_statuses(list(lb_status.values())),
    )
    clients = svc.get_clients_summary(db, now)
    finance = svc.get_finance_summary(db, now) if current_user.role == "admin" else None

    return DashboardSummary(
        generated_at=now,
        infra=infra,
        clients=clients,
        network=svc.get_network_summary(db),
        finance=finance,
        alerts=svc.build_alerts(db, infra.routers, infra.load_balancers, clients, finance, now),
        map_points=svc.get_map_points(db, router_status, lb_status),
    )


@router.get("/revenue-trend", response_model=RevenueTrend)
def get_revenue_trend(
    db: DBSession,
    _: AdminOnly,
    months: int = Query(6, ge=1, le=24),
) -> RevenueTrend:
    return svc.get_revenue_trend(db, months, svc.now_local())


@router.get("/activity", response_model=ActivityFeed)
def get_activity(
    db: DBSession,
    current_user: CurrentUser,
    limit: int = Query(10, ge=1, le=50),
) -> ActivityFeed:
    return svc.get_activity(db, include_audit=current_user.role == "admin", limit=limit)
