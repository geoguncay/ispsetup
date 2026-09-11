"""
Schemas Pydantic v2 para el módulo de Reportes (Fase 4.3).
"""
import uuid
from datetime import datetime

from pydantic import BaseModel

ReportGroupBy = str  # "month" | "quarter" | "year" — validado en la API, no como Literal para
                     # evitar acoplar el schema a la lista si se agregan agrupaciones nuevas.


# ── Reporte de ingresos ────────────────────────────────────────────────────
class RevenuePeriodPoint(BaseModel):
    label: str          # "2026-01", "2026-Q1", "2026"
    amount: float
    payments_count: int


class RevenueByPlan(BaseModel):
    plan_id: uuid.UUID | None
    plan_name: str
    amount: float
    payments_count: int


class RevenueBySite(BaseModel):
    site_id: uuid.UUID | None
    site_name: str
    amount: float
    payments_count: int


class RevenueReport(BaseModel):
    date_from: datetime
    date_to: datetime
    group_by: str
    total_amount: float
    total_payments: int
    by_period: list[RevenuePeriodPoint]
    by_plan: list[RevenueByPlan]
    by_site: list[RevenueBySite]


# ── Reporte de clientes ─────────────────────────────────────────────────────
class ClientsMonthPoint(BaseModel):
    label: str          # "2026-01"
    new_clients: int
    suspended_events: int
    churned_clients: int  # planes cancelados (ClientPlan.estado == "cancelado") en el mes


class ClientsReport(BaseModel):
    date_from: datetime
    date_to: datetime
    total_clients: int
    active_clients: int
    suspended_clients: int
    evolution: list[ClientsMonthPoint]


# ── Reporte de consumo ───────────────────────────────────────────────────────
class TopConsumerPoint(BaseModel):
    client_id: uuid.UUID
    client_name: str
    plan_name: str | None
    total_bytes: int


class PlanAveragePoint(BaseModel):
    plan_id: uuid.UUID | None
    plan_name: str
    avg_bytes_per_client: int
    clients_count: int


class PeakHourPoint(BaseModel):
    hour: int           # 0-23
    total_bytes: int


class ConsumptionReport(BaseModel):
    date_from: datetime
    date_to: datetime
    top_consumers: list[TopConsumerPoint]
    by_plan: list[PlanAveragePoint]
    peak_hours: list[PeakHourPoint]


# ── Reporte de mora ───────────────────────────────────────────────────────────
class OverdueInvoicePoint(BaseModel):
    invoice_id: uuid.UUID
    client_id: uuid.UUID
    client_name: str
    plan_name: str | None
    period: str
    due_date: datetime
    days_overdue: int
    amount: float


class OverdueReport(BaseModel):
    generated_at: datetime
    total_amount: float
    total_invoices: int
    total_clients: int
    items: list[OverdueInvoicePoint]
