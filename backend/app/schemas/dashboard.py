"""Schemas del dashboard: resumen agregado, tendencia de ingresos y actividad reciente."""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class StatusCounts(BaseModel):
    """Conteo de equipos por estado del health check (los no cacheados cuentan como `unknown`)."""

    total: int = 0
    online: int = 0
    offline: int = 0
    tunnel_down: int = 0
    degraded: int = 0
    unknown: int = 0


class InfraSummary(BaseModel):
    routers: StatusCounts
    load_balancers: StatusCounts


class ClientsSummary(BaseModel):
    total: int
    active: int
    suspended: int
    scheduled_suspensions: int
    pending_plan_changes: int
    by_medium: dict[str, int]
    by_access_method: dict[str, int]
    without_location: int


class FinanceSummary(BaseModel):
    collected_today: float
    collected_month: float
    collected_previous_month: float
    pending_invoices: int
    pending_amount: float
    overdue_invoices: int
    overdue_amount: float
    overdue_clients: int


class NetworkSummary(BaseModel):
    access_points: int
    stations: int
    ptp_links: int
    ptmp_links: int


class MapPoint(BaseModel):
    id: uuid.UUID
    name: str
    latitude: float
    longitude: float
    kind: str  # router | load_balancer | ap | station
    status: str | None = None


class DashboardAlert(BaseModel):
    # Identificador estable por tipo de alerta; el frontend lo usa para el enlace destino.
    code: str
    severity: str  # critical | warning | info
    title: str
    count: int
    detail: str | None = None
    # Ruta del frontend donde se atiende la alerta (p. ej. "/routers").
    link: str | None = None


class DashboardSummary(BaseModel):
    generated_at: datetime
    infra: InfraSummary
    clients: ClientsSummary
    network: NetworkSummary
    # Solo admin: los demás roles reciben null.
    finance: FinanceSummary | None = None
    alerts: list[DashboardAlert] = Field(default_factory=list)
    map_points: list[MapPoint] = Field(default_factory=list)


class RevenueTrendPoint(BaseModel):
    label: str  # "AAAA-MM"
    amount: float
    payments_count: int


class RevenueTrend(BaseModel):
    points: list[RevenueTrendPoint]


class ActivityItem(BaseModel):
    id: str
    kind: str  # audit | suspension | reactivation
    action: str
    title: str
    entity_type: str | None = None
    entity_name: str | None = None
    user_name: str | None = None
    created_at: datetime


class ActivityFeed(BaseModel):
    items: list[ActivityItem]
