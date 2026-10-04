"""
Endpoints API para el módulo de Reportes (Fase 4.3): ingresos, clientes,
consumo y mora, cada uno con su vista de datos (JSON) y export a PDF/Excel.
"""
import logging
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.core.deps import AdminOrTechnician, DBSession
from app.models.company import Company
from app.schemas.reports import ClientsReport, ConsumptionReport, OverdueReport, RevenuePeriodDetail, RevenueReport
from app.services.reports.excel_export import (
    generate_clients_excel,
    generate_consumption_excel,
    generate_overdue_excel,
    generate_revenue_excel,
)
from app.services.reports.pdf_export import (
    generate_clients_pdf,
    generate_consumption_pdf,
    generate_overdue_pdf,
    generate_revenue_pdf,
)
from app.services.reports.queries import (
    get_clients_report,
    get_consumption_report,
    get_overdue_report,
    get_revenue_period_detail,
    get_revenue_report,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"])

_EXCEL_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _to_range(date_from: date | None, date_to: date | None, default_days: int) -> tuple[datetime, datetime]:
    """Convierte fechas (o nada) a un rango datetime UTC con límites inclusivos."""
    end = datetime.combine(date_to, time.max, tzinfo=timezone.utc) if date_to else datetime.now(timezone.utc)
    start = (
        datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        if date_from
        else end - timedelta(days=default_days)
    )
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from no puede ser posterior a date_to")
    return start, end


def _company(db: DBSession) -> Company | None:
    return db.query(Company).first()


def _attachment(buffer_bytes: bytes, media_type: str, filename: str) -> Response:
    return Response(
        content=buffer_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── Ingresos ──────────────────────────────────────────────────────────────────
@router.get("/revenue", response_model=RevenueReport)
def revenue_report(
    db: DBSession,
    _: AdminOrTechnician,
    group_by: str = Query(default="month", pattern="^(month|quarter|year)$"),
    date_from: date | None = None,
    date_to: date | None = None,
) -> RevenueReport:
    start, end = _to_range(date_from, date_to, default_days=365)
    return get_revenue_report(db, group_by, start, end)


@router.get("/revenue/period", response_model=RevenuePeriodDetail)
def revenue_period_detail(
    db: DBSession,
    _: AdminOrTechnician,
    label: str,
    group_by: str = Query(default="month", pattern="^(month|quarter|year)$"),
    date_from: date | None = None,
) -> RevenuePeriodDetail:
    """Ingresos de un período (simple) y acumulados desde el inicio del rango hasta su fin."""
    range_from, _end = _to_range(date_from, None, default_days=365)
    try:
        return get_revenue_period_detail(db, label, group_by, range_from)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/revenue/pdf")
def revenue_report_pdf(
    db: DBSession,
    _: AdminOrTechnician,
    group_by: str = Query(default="month", pattern="^(month|quarter|year)$"),
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    start, end = _to_range(date_from, date_to, default_days=365)
    report = get_revenue_report(db, group_by, start, end)
    buffer = generate_revenue_pdf(report, _company(db))
    return _attachment(buffer.getvalue(), "application/pdf", "reporte_ingresos.pdf")


@router.get("/revenue/excel")
def revenue_report_excel(
    db: DBSession,
    _: AdminOrTechnician,
    group_by: str = Query(default="month", pattern="^(month|quarter|year)$"),
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    start, end = _to_range(date_from, date_to, default_days=365)
    report = get_revenue_report(db, group_by, start, end)
    buffer = generate_revenue_excel(report)
    return _attachment(buffer.getvalue(), _EXCEL_MEDIA_TYPE, "reporte_ingresos.xlsx")


# ── Clientes ──────────────────────────────────────────────────────────────────
@router.get("/clients", response_model=ClientsReport)
def clients_report(
    db: DBSession, _: AdminOrTechnician, date_from: date | None = None, date_to: date | None = None
) -> ClientsReport:
    start, end = _to_range(date_from, date_to, default_days=180)
    return get_clients_report(db, start, end)


@router.get("/clients/pdf")
def clients_report_pdf(
    db: DBSession, _: AdminOrTechnician, date_from: date | None = None, date_to: date | None = None
) -> Response:
    start, end = _to_range(date_from, date_to, default_days=180)
    report = get_clients_report(db, start, end)
    buffer = generate_clients_pdf(report, _company(db))
    return _attachment(buffer.getvalue(), "application/pdf", "reporte_clientes.pdf")


@router.get("/clients/excel")
def clients_report_excel(
    db: DBSession, _: AdminOrTechnician, date_from: date | None = None, date_to: date | None = None
) -> Response:
    start, end = _to_range(date_from, date_to, default_days=180)
    report = get_clients_report(db, start, end)
    buffer = generate_clients_excel(report)
    return _attachment(buffer.getvalue(), _EXCEL_MEDIA_TYPE, "reporte_clientes.xlsx")


# ── Consumo ───────────────────────────────────────────────────────────────────
@router.get("/consumption", response_model=ConsumptionReport)
def consumption_report(
    db: DBSession,
    _: AdminOrTechnician,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=10, ge=1, le=100),
) -> ConsumptionReport:
    start, end = _to_range(date_from, date_to, default_days=30)
    return get_consumption_report(db, start, end, limit)


@router.get("/consumption/pdf")
def consumption_report_pdf(
    db: DBSession,
    _: AdminOrTechnician,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=10, ge=1, le=100),
) -> Response:
    start, end = _to_range(date_from, date_to, default_days=30)
    report = get_consumption_report(db, start, end, limit)
    buffer = generate_consumption_pdf(report, _company(db))
    return _attachment(buffer.getvalue(), "application/pdf", "reporte_consumo.pdf")


@router.get("/consumption/excel")
def consumption_report_excel(
    db: DBSession,
    _: AdminOrTechnician,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=10, ge=1, le=100),
) -> Response:
    start, end = _to_range(date_from, date_to, default_days=30)
    report = get_consumption_report(db, start, end, limit)
    buffer = generate_consumption_excel(report)
    return _attachment(buffer.getvalue(), _EXCEL_MEDIA_TYPE, "reporte_consumo.xlsx")


# ── Mora ──────────────────────────────────────────────────────────────────────
@router.get("/overdue", response_model=OverdueReport)
def overdue_report(db: DBSession, _: AdminOrTechnician) -> OverdueReport:
    return get_overdue_report(db)


@router.get("/overdue/pdf")
def overdue_report_pdf(db: DBSession, _: AdminOrTechnician) -> Response:
    report = get_overdue_report(db)
    buffer = generate_overdue_pdf(report, _company(db))
    return _attachment(buffer.getvalue(), "application/pdf", "reporte_mora.pdf")


@router.get("/overdue/excel")
def overdue_report_excel(db: DBSession, _: AdminOrTechnician) -> Response:
    report = get_overdue_report(db)
    buffer = generate_overdue_excel(report)
    return _attachment(buffer.getvalue(), _EXCEL_MEDIA_TYPE, "reporte_mora.xlsx")
