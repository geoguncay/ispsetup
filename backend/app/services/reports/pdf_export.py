"""
Export a PDF de los reportes (Fase 4.3), con ReportLab — mismo enfoque que
`app.services.pdf_generator` (recibos de pago).
"""
from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.company import Company
from app.schemas.reports import ClientsReport, ConsumptionReport, OverdueReport, RevenueReport

_HEADER_BG = colors.HexColor("#1e3a8a")
_ROW_ALT_BG = colors.HexColor("#f3f4f6")
_TEXT = colors.HexColor("#111827")
_MUTED = colors.HexColor("#6b7280")


def _base_doc() -> tuple[BytesIO, SimpleDocTemplate, list]:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40
    )
    return buffer, doc, []


def _title_block(story: list, title: str, company: Company | None, subtitle: str) -> None:
    styles = getSampleStyleSheet()
    company_name = company.name if company else "ISP SETUP"
    story.append(Paragraph(f"<b><font size=16 color='#1e3a8a'>{company_name}</font></b>", styles["Normal"]))
    story.append(Paragraph(f"<font size=13><b>{title}</b></font>", styles["Normal"]))
    story.append(Paragraph(f"<font size=9 color='#6b7280'>{subtitle}</font>", styles["Normal"]))
    story.append(Spacer(1, 14))


def _table(data: list[list[str]], col_widths: list[float] | None = None) -> Table:
    table = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), _TEXT),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ROW_ALT_BG]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    table.setStyle(TableStyle(style))
    return table


def _period_range_label(date_from: datetime, date_to: datetime) -> str:
    return f"Período: {date_from.strftime('%d/%m/%Y')} — {date_to.strftime('%d/%m/%Y')}"


def generate_revenue_pdf(report: RevenueReport, company: Company | None = None) -> BytesIO:
    buffer, doc, story = _base_doc()
    _title_block(story, "Reporte de ingresos", company, _period_range_label(report.date_from, report.date_to))

    styles = getSampleStyleSheet()
    story.append(Paragraph(f"<b>Total recaudado:</b> ${report.total_amount:,.2f} ({report.total_payments} pagos)", styles["Normal"]))
    story.append(Spacer(1, 10))

    story.append(Paragraph(f"<b>Por período ({report.group_by})</b>", styles["Normal"]))
    rows = [["Período", "Monto", "Pagos"]] + [
        [p.label, f"${p.amount:,.2f}", str(p.payments_count)] for p in report.by_period
    ]
    story.append(_table(rows))
    story.append(Spacer(1, 14))

    story.append(Paragraph("<b>Por plan</b>", styles["Normal"]))
    rows = [["Plan", "Monto", "Pagos"]] + [
        [p.plan_name, f"${p.amount:,.2f}", str(p.payments_count)] for p in report.by_plan
    ]
    story.append(_table(rows))
    story.append(Spacer(1, 14))

    story.append(Paragraph("<b>Por sitio</b>", styles["Normal"]))
    rows = [["Sitio", "Monto", "Pagos"]] + [
        [s.site_name, f"${s.amount:,.2f}", str(s.payments_count)] for s in report.by_site
    ]
    story.append(_table(rows))

    doc.build(story)
    buffer.seek(0)
    return buffer


def generate_clients_pdf(report: ClientsReport, company: Company | None = None) -> BytesIO:
    buffer, doc, story = _base_doc()
    _title_block(story, "Reporte de clientes", company, _period_range_label(report.date_from, report.date_to))

    styles = getSampleStyleSheet()
    story.append(Paragraph(
        f"<b>Totales actuales:</b> {report.total_clients} clientes — "
        f"{report.active_clients} activos, {report.suspended_clients} suspendidos",
        styles["Normal"],
    ))
    story.append(Spacer(1, 10))

    story.append(Paragraph("<b>Evolución mensual</b>", styles["Normal"]))
    rows = [["Mes", "Nuevos", "Suspensiones", "Bajas (planes cancelados)"]] + [
        [e.label, str(e.new_clients), str(e.suspended_events), str(e.churned_clients)] for e in report.evolution
    ]
    story.append(_table(rows))

    doc.build(story)
    buffer.seek(0)
    return buffer


def _format_bytes(n: int) -> str:
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:,.1f} {unit}"
        value /= 1024
    return f"{value:,.1f} TB"


def generate_consumption_pdf(report: ConsumptionReport, company: Company | None = None) -> BytesIO:
    buffer, doc, story = _base_doc()
    _title_block(story, "Reporte de consumo", company, _period_range_label(report.date_from, report.date_to))

    styles = getSampleStyleSheet()
    story.append(Paragraph("<b>Top consumidores</b>", styles["Normal"]))
    rows = [["Cliente", "Plan", "Consumo"]] + [
        [c.client_name, c.plan_name or "—", _format_bytes(c.total_bytes)] for c in report.top_consumers
    ]
    story.append(_table(rows))
    story.append(Spacer(1, 14))

    story.append(Paragraph("<b>Promedio por plan</b>", styles["Normal"]))
    rows = [["Plan", "Promedio por cliente", "Clientes"]] + [
        [p.plan_name, _format_bytes(p.avg_bytes_per_client), str(p.clients_count)] for p in report.by_plan
    ]
    story.append(_table(rows))
    story.append(Spacer(1, 14))

    story.append(Paragraph("<b>Horas pico</b>", styles["Normal"]))
    rows = [["Hora", "Consumo total"]] + [
        [f"{h.hour:02d}:00", _format_bytes(h.total_bytes)] for h in report.peak_hours[:10]
    ]
    story.append(_table(rows))

    doc.build(story)
    buffer.seek(0)
    return buffer


def generate_overdue_pdf(report: OverdueReport, company: Company | None = None) -> BytesIO:
    buffer, doc, story = _base_doc()
    _title_block(
        story, "Reporte de mora", company,
        f"Generado: {report.generated_at.strftime('%d/%m/%Y %H:%M')}",
    )

    styles = getSampleStyleSheet()
    story.append(Paragraph(
        f"<b>{report.total_clients}</b> clientes en mora — <b>{report.total_invoices}</b> facturas vencidas — "
        f"<b>${report.total_amount:,.2f}</b> en total",
        styles["Normal"],
    ))
    story.append(Spacer(1, 10))

    rows = [["Cliente", "Plan", "Período", "Vencimiento", "Días de mora", "Monto"]] + [
        [
            i.client_name, i.plan_name or "—", i.period,
            i.due_date.strftime("%d/%m/%Y"), str(i.days_overdue), f"${i.amount:,.2f}",
        ]
        for i in report.items
    ]
    story.append(_table(rows))

    doc.build(story)
    buffer.seek(0)
    return buffer
