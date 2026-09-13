"""
Cálculo de ciclos de facturación: día de generación, vencimiento y prorrateo
por cambio de plan a mitad de periodo.

`billing_day_for` y `resolve_due_date` vivían originalmente en
`app.workers.billing`; se movieron aquí para poder reutilizarlas también
desde `app.api.clients` (cambio de plan inmediato) sin acoplar la API al
paquete de tareas Celery.
"""
import calendar
from datetime import datetime, timedelta

from app.models.client import Client
from app.models.invoice import Invoice
from app.models.plan import Plan
from app.models.system_settings import SystemSettings


def effective_price(price: float, tax_rate: float, price_mode: str) -> float:
    """
    Monto que corresponde cobrar por un ítem (plan o servicio personalizado)
    según Ajustes > Facturación > Configuración de Facturación:
    - "included" (default): `price` ya incluye el impuesto, se cobra tal cual.
    - "excluded": `price` es la base sin impuesto; se le suma la tasa fiscal
      global (Ajustes > Fiscal) para obtener el monto final a cobrar.
    """
    if price_mode == "excluded":
        return round(float(price) * (1 + float(tax_rate) / 100), 2)
    return float(price)


def billing_day_for(client: Client, cfg: SystemSettings) -> int:
    """
    Día del mes en que corresponde generar la factura del cliente, según
    la configuración de Ajustes: "fixed_day" (billing_default_payment_day, igual
    para todos), "cutoff_date" (día de corte propio del cliente, billing_period_start_day)
    o "billing_start" (día del mes en que inició la facturación del cliente,
    usando su fecha de alta si no tiene billing_start definido).
    """
    if cfg.billing_generation_mode == "cutoff_date":
        return client.billing_period_start_day or 1
    if cfg.billing_generation_mode == "billing_start":
        start_date = client.billing_start or client.created_at
        return start_date.day if start_date else 1
    return cfg.billing_default_payment_day or 1


def resolve_due_date(issue_date: datetime, client: Client, cfg: SystemSettings) -> datetime:
    """
    Calcula la fecha de vencimiento de una factura según la configuración de Ajustes:
    - modo "fixed_term": issue_date + billing_default_grace_days días.
    - modo "cutoff_date": coincide con el día de corte del cliente (billing_period_start_day),
      usando el próximo día de corte a partir de la emisión.
    - hora "start_of_day"/"end_of_day": fija la hora del resultado a 00:00:00 o 23:59:59.
    """
    if cfg.billing_due_mode == "cutoff_date":
        cutoff_day = client.billing_period_start_day or issue_date.day
        last_day = calendar.monthrange(issue_date.year, issue_date.month)[1]
        due_date = issue_date.replace(day=min(cutoff_day, last_day))
        if due_date.date() < issue_date.date():
            next_month = issue_date.month % 12 + 1
            next_year = issue_date.year + (1 if issue_date.month == 12 else 0)
            last_day_next = calendar.monthrange(next_year, next_month)[1]
            due_date = issue_date.replace(
                year=next_year, month=next_month, day=min(cutoff_day, last_day_next)
            )
    else:
        grace_days = cfg.billing_default_grace_days if cfg.billing_default_grace_days is not None else 10
        due_date = issue_date + timedelta(days=grace_days)

    # Resguardo: el vencimiento nunca puede quedar antes que la emisión, sin importar
    # la configuración (p. ej. un cutoff_day mal calculado o días de gracia en 0 con
    # un issue_date ya avanzado en el día).
    if due_date.date() < issue_date.date():
        due_date = issue_date

    if cfg.billing_due_time == "start_of_day":
        return due_date.replace(hour=0, minute=0, second=0, microsecond=0)
    return due_date.replace(hour=23, minute=59, second=59, microsecond=0)


def current_period_bounds(client: Client, cfg: SystemSettings, now: datetime) -> tuple[datetime, datetime]:
    """
    Calcula el inicio y fin del periodo de facturación mensual vigente para el
    cliente en el instante `now`, según su día de generación (`billing_day_for`).
    Ambas fechas quedan normalizadas a las 00:00:00 de su día correspondiente.
    """
    target_day = billing_day_for(client, cfg)
    last_day_this_month = calendar.monthrange(now.year, now.month)[1]
    this_month_boundary = now.replace(
        day=min(target_day, last_day_this_month), hour=0, minute=0, second=0, microsecond=0
    )

    if now >= this_month_boundary:
        period_start = this_month_boundary
        next_month = now.month % 12 + 1
        next_year = now.year + (1 if now.month == 12 else 0)
        last_day_next = calendar.monthrange(next_year, next_month)[1]
        period_end = this_month_boundary.replace(
            year=next_year, month=next_month, day=min(target_day, last_day_next)
        )
    else:
        prev_month = now.month - 1 or 12
        prev_year = now.year - 1 if now.month == 1 else now.year
        last_day_prev = calendar.monthrange(prev_year, prev_month)[1]
        period_start = this_month_boundary.replace(
            year=prev_year, month=prev_month, day=min(target_day, last_day_prev)
        )
        period_end = this_month_boundary

    return period_start, period_end


def compute_plan_change_proration(
    old_plan_price: float, new_plan_price: float, client: Client, cfg: SystemSettings, now: datetime
) -> tuple[float, int, int]:
    """
    Calcula el ajuste neto por cambiar de plan a mitad del periodo de
    facturación mensual vigente: la diferencia de precio entre el plan nuevo
    y el viejo, prorrateada solo por los días que quedan del periodo actual.

    Un resultado positivo es un cargo adicional (upgrade); uno negativo es un
    crédito a favor del cliente (downgrade). Devuelve (monto, días_restantes,
    días_del_periodo).
    """
    period_start, period_end = current_period_bounds(client, cfg, now)
    days_in_period = max((period_end - period_start).days, 1)
    days_used = min(max((now - period_start).days, 0), days_in_period)
    days_remaining = days_in_period - days_used

    price_diff = float(new_plan_price) - float(old_plan_price)
    amount = round(price_diff * days_remaining / days_in_period, 2)
    return amount, days_remaining, days_in_period


def period_bounds_for(target_day: int, year: int, month: int) -> tuple[datetime, datetime]:
    """
    Límites [inicio, fin) del periodo mensual cuyo día de corte es
    `target_day`, para el periodo que arranca en `month`/`year` (ajustado al
    último día del mes si `target_day` no existe en él, ej. 31 en febrero).
    """
    last_day_this = calendar.monthrange(year, month)[1]
    period_start = datetime(year, month, min(target_day, last_day_this))
    next_month = month % 12 + 1
    next_year = year + (1 if month == 12 else 0)
    last_day_next = calendar.monthrange(next_year, next_month)[1]
    period_end = datetime(next_year, next_month, min(target_day, last_day_next))
    return period_start, period_end


def advance_period(period: str) -> str:
    """Periodo "MM/AAAA" inmediatamente siguiente al dado."""
    month, year = int(period[:2]), int(period[3:])
    month += 1
    if month > 12:
        month = 1
        year += 1
    return f"{month:02d}/{year}"


def prorated_first_invoice_amount(base_amount: float, client: Client, cfg: SystemSettings, period: str) -> float:
    """
    Si `period` ("MM/AAAA") es el primer periodo de facturación del cliente
    (el que contiene su fecha de inicio: `billing_start`, o `created_at` si no
    tiene) y ese inicio cae a mitad del periodo, devuelve `base_amount`
    prorrateado por los días que quedan desde el inicio hasta el fin del
    periodo. En cualquier otro caso (periodos posteriores, o el cliente
    empezó justo en el día de corte) devuelve `base_amount` sin cambios.
    """
    start_date = client.billing_start or client.created_at
    if not start_date:
        return base_amount

    month, year = int(period[:2]), int(period[3:])
    target_day = billing_day_for(client, cfg)
    period_start, period_end = period_bounds_for(target_day, year, month)

    start_naive = start_date.replace(tzinfo=None) if start_date.tzinfo else start_date
    if start_naive <= period_start or start_naive >= period_end:
        return base_amount

    days_in_period = max((period_end - period_start).days, 1)
    days_used = (start_naive - period_start).days
    days_remaining = max(days_in_period - days_used, 0)
    return round(base_amount * days_remaining / days_in_period, 2)


def compute_invoice_amount(client: Client, plan: Plan, cfg: SystemSettings, period: str) -> tuple[float, bool]:
    """
    Monto que corresponde facturar a `client` por `period` ("MM/AAAA"): plan +
    servicios personalizados activos, con impuesto según Ajustes >
    Facturación. Si `period` es su primer periodo y arrancó a mitad de mes,
    prorratea el plan y los servicios recurrentes (los servicios NO
    recurrentes —ej. una instalación— se cobran completos, sin prorratear).

    Devuelve (monto_total, fue_prorrateado).
    """
    recurring_services = [cs for cs in client.custom_services if cs.recurring]
    one_time_services = [cs for cs in client.custom_services if not cs.recurring]

    recurring_amount = effective_price(plan.price, cfg.fiscal_tax_rate, cfg.billing_price_mode) + sum(
        effective_price(cs.price, cfg.fiscal_tax_rate, cfg.billing_price_mode) for cs in recurring_services
    )
    one_time_amount = sum(
        effective_price(cs.price, cfg.fiscal_tax_rate, cfg.billing_price_mode) for cs in one_time_services
    )

    prorated_recurring_amount = prorated_first_invoice_amount(recurring_amount, client, cfg, period)
    total = round(prorated_recurring_amount + one_time_amount, 2)
    return total, prorated_recurring_amount != recurring_amount


def oldest_unpaid_period(db, client_id, start_date: datetime, now: datetime) -> str:
    """
    Igual que `oldest_pending_period`, pero solo salta los periodos que ya
    tienen una factura PAGADA. Un periodo con factura pendiente o vencida
    cuenta como "todavía vigente" (sigue siendo la factura "actual" a mostrar
    hasta que se registre el pago). Usado por la vista previa de Facturación
    Proyectada en el modal de cliente.

    Si el cliente ya tiene pagado hasta el periodo de `now` inclusive,
    devuelve el periodo siguiente (proyectado): es lo que reemplaza a la
    "Primera factura" en la vista una vez que se paga.
    """
    paid_periods = {
        p for (p,) in db.query(Invoice.period)
        .filter(Invoice.client_id == client_id, Invoice.status == "paid")
        .all()
    }
    year, month = start_date.year, start_date.month
    while (year, month) <= (now.year, now.month):
        period = f"{month:02d}/{year}"
        if period not in paid_periods:
            return period
        month += 1
        if month > 12:
            month = 1
            year += 1
    return advance_period(now.strftime("%m/%Y"))


def oldest_pending_period(db, client_id, start_date: datetime, now: datetime) -> str:
    """
    Periodo "MM/AAAA" más antiguo, entre el mes de `start_date` y el mes de
    `now` (inclusive), que el cliente todavía no tiene facturado (sin contar
    facturas anuladas). Si ya están todos facturados, devuelve el periodo de
    `now` (el caso normal: solo falta el mes en curso).

    Sirve para que la generación manual ("Generar Factura" en el modal de
    cliente) vaya poniendo al día, uno por click, los periodos atrasados de un
    cliente que empezó a facturarse tarde (ej. se le asignó el plan varios
    meses después de su fecha de alta).
    """
    billed_periods = {
        p for (p,) in db.query(Invoice.period)
        .filter(Invoice.client_id == client_id, Invoice.status != "cancelled")
        .all()
    }
    year, month = start_date.year, start_date.month
    while (year, month) <= (now.year, now.month):
        period = f"{month:02d}/{year}"
        if period not in billed_periods:
            return period
        month += 1
        if month > 12:
            month = 1
            year += 1
    return now.strftime("%m/%Y")


def generate_invoice_for_client(
    db, client: Client, plan: Plan, cfg: SystemSettings, now: datetime, period: str | None = None,
) -> Invoice:
    """
    Crea (sin hacer commit) la factura de `period` (por defecto, el periodo de
    `now`) para `client` con su plan activo, sumando servicios personalizados
    activos y aplicando el impuesto según Ajustes > Facturación. Los servicios
    personalizados no recurrentes se remueven del cliente al quedar incluidos
    en esta factura.

    `period` solo cambia la etiqueta "MM/AAAA" de la factura (para ponerse al
    día con periodos atrasados) y si corresponde prorratearla (ver
    `compute_invoice_amount`); la emisión y el vencimiento siempre se calculan
    sobre `now`, el momento real en que se genera.

    No valida duplicados ni que el cliente tenga plan activo: eso es
    responsabilidad del llamador (ver `app.workers.billing.generate_monthly_invoices`
    y el endpoint de generación manual en `app.api.clients`).
    """
    period = period or now.strftime("%m/%Y")
    issue_date = now
    due_date = resolve_due_date(issue_date, client, cfg)

    active_custom_services = list(client.custom_services)
    total_amount, _ = compute_invoice_amount(client, plan, cfg, period)

    new_invoice = Invoice(
        client_id=client.id,
        plan_id=plan.id,
        period=period,
        amount=total_amount,
        issue_date=issue_date,
        due_date=due_date,
        status="pending",
        custom_services=active_custom_services,
    )

    for cs in active_custom_services:
        if not cs.recurring:
            client.custom_services.remove(cs)

    db.add(new_invoice)
    return new_invoice
