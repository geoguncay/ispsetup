"""
Tareas Celery para facturación mensual automatizada y control de vencimientos.
"""
import calendar
import logging
from datetime import datetime, timezone

from app.core import database
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.invoice import Invoice
from app.models.plan import Plan
from app.models.system_settings import SystemSettings
from app.services.billing_cycle import (
    billing_day_for as _billing_day_for,
    generate_invoice_for_client,
)
from app.services.plan_change import apply_plan_change
from app.workers.celery_app import celery_app
from app.services.audit_service import AuditAction, audit_detail, log_event

logger = logging.getLogger(__name__)


def _get_settings(db) -> SystemSettings:
    cfg = db.query(SystemSettings).first()
    if not cfg:
        cfg = SystemSettings()
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


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


@celery_app.task(name="app.workers.billing.generate_monthly_invoices")
def generate_monthly_invoices(
    force: bool = False,
    audit_user_id: str | None = None,
    audit_user_name: str | None = None,
):
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

            # Si el cliente tiene un cambio de plan diferido ("al iniciar nuevo
            # periodo"), aplicarlo ahora, justo antes de facturar este periodo,
            # para que la factura que se genere a continuación ya use el plan nuevo.
            if client.pending_plan_id:
                pending_plan = db.get(Plan, client.pending_plan_id)
                if pending_plan:
                    try:
                        # SAVEPOINT propio: si falla la sincronización con MikroTik,
                        # solo se revierte lo de este cliente, sin arrastrar las
                        # facturas de otros clientes ya generadas (aún sin commit)
                        # en esta misma corrida del lote.
                        with db.begin_nested():
                            apply_plan_change(db, client, pending_plan, commit=False)
                            client.pending_plan_id = None
                            client.pending_plan_requested_at = None
                        log_event(
                            db, AuditAction.ASSIGN_PLAN,
                            entity_type="Client", entity_id=client.id, entity_name=client.full_name,
                            detail=audit_detail(
                                "Cambio de plan diferido aplicado al iniciar el nuevo periodo",
                                plan_name=pending_plan.name, source="generate_monthly_invoices",
                            ),
                        )
                    except Exception as e:
                        logger.error(
                            f"Fallo al aplicar el cambio de plan diferido de {client.full_name} "
                            f"a '{pending_plan.name}': {e}. Se reintentará en la próxima corrida.",
                            exc_info=True,
                        )
                else:
                    # El plan pendiente ya no existe (fue eliminado): descartar el cambio.
                    client.pending_plan_id = None
                    client.pending_plan_requested_at = None
                    db.commit()

            # Buscar el plan activo del cliente
            active_client_plan = (
                db.query(ClientPlan)
                .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
                .first()
            )

            if not active_client_plan or not active_client_plan.plan:
                logger.warning(f"El cliente {client.full_name} ({client.id}) está activo pero no tiene un plan activo asignado.")
                continue

            plan = active_client_plan.plan

            # Verificar si ya existe factura para este cliente en el periodo actual
            # (una factura anulada no cuenta: el periodo queda libre para re-facturarse)
            existing_invoice = (
                db.query(Invoice)
                .filter(
                    Invoice.client_id == client.id, Invoice.period == current_period,
                    Invoice.status != "cancelled",
                )
                .first()
            )

            if existing_invoice:
                logger.info(f"El cliente {client.full_name} ya tiene una factura para el periodo {current_period}.")
                continue

            # Crear factura: plan base + servicios personalizados, sumando el IVA por
            # ítem si Ajustes > Facturación tiene el modo "excluded" (precio sin impuesto).
            new_invoice = generate_invoice_for_client(db, client, plan, cfg, now)
            invoices_created += 1
            logger.info(f"Factura generada para {client.full_name} — Periodo: {current_period}, Monto: ${new_invoice.amount:.2f}")
            
        db.commit()
        log_event(
            db, AuditAction.GENERATE_MONTHLY_INVOICES,
            entity_type="InvoiceBatch", entity_id=current_period,
            entity_name=f"Facturación {current_period}",
            user_id=audit_user_id, user_name=audit_user_name,
            detail=audit_detail(
                "Generación mensual de facturas completada",
                period=current_period, invoices_created=invoices_created,
                forced=force, active_clients=len(active_clients),
            ),
        )
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
        log_event(
            db, AuditAction.MARK_INVOICES_OVERDUE,
            entity_type="InvoiceBatch", entity_id=now.date().isoformat(),
            entity_name="Control de vencimientos",
            detail=audit_detail(
                "Verificación diaria de facturas vencidas completada",
                updated_count=updated_count,
            ),
        )
        logger.info(f"Verificación de vencimientos completada. Facturas marcadas como vencidas: {updated_count}")
        return {"status": "success", "updated_count": updated_count}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error en check_overdue_invoices: {str(e)}", exc_info=True)
        return {"status": "error", "detail": str(e)}
    finally:
        db.close()
