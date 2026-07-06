"""
Tareas Celery para facturación mensual automatizada y control de vencimientos.
"""
import calendar
import logging
from datetime import datetime, timedelta, timezone

from app.core import database
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.invoice import Invoice
from app.models.system_settings import SystemSettings
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _get_settings(db) -> SystemSettings:
    cfg = db.query(SystemSettings).first()
    if not cfg:
        cfg = SystemSettings()
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _billing_day_for(client: Client, cfg: SystemSettings) -> int:
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


def _should_generate_today(now: datetime, client: Client, cfg: SystemSettings) -> bool:
    """
    True si hoy es el día configurado para generar la factura del cliente y ya
    se alcanzó la hora de generación configurada (billing_generation_time).
    Ajusta al último día del mes cuando el día objetivo no existe (ej. 31 en febrero).
    """
    target_day = _billing_day_for(client, cfg)
    last_day = calendar.monthrange(now.year, now.month)[1]
    if now.day != min(target_day, last_day):
        return False

    try:
        hour_cfg, minute_cfg = (int(x) for x in (cfg.billing_generation_time or "08:00").split(":"))
    except ValueError:
        hour_cfg, minute_cfg = 8, 0
    return (now.hour, now.minute) >= (hour_cfg, minute_cfg)


def _resolve_due_date(issue_date: datetime, client: Client, cfg: SystemSettings) -> datetime:
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

    if cfg.billing_due_time == "start_of_day":
        return due_date.replace(hour=0, minute=0, second=0, microsecond=0)
    return due_date.replace(hour=23, minute=59, second=59, microsecond=0)


@celery_app.task(name="app.workers.billing.generate_monthly_invoices")
def generate_monthly_invoices(force: bool = False):
    """
    Busca todos los clientes activos con un plan activo y les genera
    su factura correspondiente al periodo del mes actual (formato MM/AAAA),
    evitando generar facturas duplicadas para el mismo periodo.

    Por defecto solo genera la factura de un cliente si hoy coincide con su día
    de generación configurado (Ajustes > Facturación) y ya se alcanzó la hora
    configurada. `force=True` (usado por el disparo manual) ignora ese filtro.
    """
    logger.info("Iniciando generación automática de facturas mensuales...")
    db = database.SessionLocal()
    
    try:
        # Obtener fecha actual en zona local
        now = datetime.now()
        current_period = now.strftime("%m/%Y")
        cfg = _get_settings(db)

        # Obtener todos los clientes activos
        active_clients = db.query(Client).filter(Client.active == True).all()
        logger.info(f"Se encontraron {len(active_clients)} clientes activos para facturar.")

        invoices_created = 0

        for client in active_clients:
            if not force and not _should_generate_today(now, client, cfg):
                continue

            # Buscar el plan activo del cliente
            active_client_plan = (
                db.query(ClientPlan)
                .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
                .first()
            )

            if not active_client_plan or not active_client_plan.plan:
                logger.warning(f"El cliente {client.name} ({client.id}) está activo pero no tiene un plan activo asignado.")
                continue

            plan = active_client_plan.plan

            # Verificar si ya existe factura para este cliente en el periodo actual
            existing_invoice = (
                db.query(Invoice)
                .filter(Invoice.client_id == client.id, Invoice.period == current_period)
                .first()
            )

            if existing_invoice:
                logger.info(f"El cliente {client.name} ya tiene una factura para el periodo {current_period}.")
                continue

            # Crear factura
            issue_date = now
            due_date = _resolve_due_date(issue_date, client, cfg)

            # Calcular monto total: plan base + servicios personalizados
            active_custom_services = list(client.custom_services)
            total_amount = plan.price + sum(cs.price for cs in active_custom_services)

            new_invoice = Invoice(
                client_id=client.id,
                plan_id=plan.id,
                period=current_period,
                amount=total_amount,
                issue_date=issue_date,
                due_date=due_date,
                status="pending",
                custom_services=active_custom_services
            )

            # Remover servicios no recurrentes del cliente
            for cs in active_custom_services:
                if not cs.recurring:
                    client.custom_services.remove(cs)

            db.add(new_invoice)
            invoices_created += 1
            logger.info(f"Factura generada para {client.name} — Periodo: {current_period}, Monto: ${total_amount:.2f}")
            
        db.commit()
        logger.info(f"Generación de facturas completada. Facturas creadas: {invoices_created}")
        return {"status": "success", "invoices_created": invoices_created}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error en generate_monthly_invoices: {str(e)}", exc_info=True)
        return {"status": "error", "detail": str(e)}
    finally:
        db.close()


@celery_app.task(name="app.workers.billing.check_overdue_invoices")
def check_overdue_invoices():
    """
    Tarea diaria que busca facturas en estado 'pendiente' cuyo vencimiento
    ya pasó y las actualiza a estado 'vencido'.
    """
    logger.info("Iniciando verificación diaria de facturas vencidas...")
    db = database.SessionLocal()
    
    try:
        now = datetime.now()
        
        # Buscar facturas pendientes cuya due_date sea menor que ahora
        overdue_invoices = (
            db.query(Invoice)
            .filter(Invoice.status == "pending", Invoice.due_date < now)
            .all()
        )

        updated_count = 0
        for invoice in overdue_invoices:
            invoice.status = "overdue"
            updated_count += 1
            logger.info(f"Factura {invoice.id} del cliente {invoice.client_id} marcada como VENCIDA.")
            
        db.commit()
        logger.info(f"Verificación de vencimientos completada. Facturas marcadas como vencidas: {updated_count}")
        return {"status": "success", "updated_count": updated_count}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error en check_overdue_invoices: {str(e)}", exc_info=True)
        return {"status": "error", "detail": str(e)}
    finally:
        db.close()
