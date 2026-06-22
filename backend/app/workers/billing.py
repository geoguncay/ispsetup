"""
Tareas Celery para facturación mensual automatizada y control de vencimientos.
"""
import logging
from datetime import datetime, timedelta, timezone

from app.core import database
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.invoice import Invoice
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.billing.generate_monthly_invoices")
def generate_monthly_invoices():
    """
    Busca todos los clientes activos con un plan activo y les genera
    su factura correspondiente al periodo del mes actual (formato MM/AAAA),
    evitando generar facturas duplicadas para el mismo periodo.
    """
    logger.info("Iniciando generación automática de facturas mensuales...")
    db = database.SessionLocal()
    
    try:
        # Obtener fecha actual en zona local
        now = datetime.now()
        periodo_actual = now.strftime("%m/%Y")
        
        # Obtener todos los clientes activos
        active_clients = db.query(Client).filter(Client.activo == True).all()
        logger.info(f"Se encontraron {len(active_clients)} clientes activos para facturar.")
        
        invoices_created = 0
        
        for client in active_clients:
            # Buscar el plan activo del cliente
            active_client_plan = (
                db.query(ClientPlan)
                .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
                .first()
            )
            
            if not active_client_plan or not active_client_plan.plan:
                logger.warning(f"El cliente {client.nombre} ({client.id}) está activo pero no tiene un plan activo asignado.")
                continue
                
            plan = active_client_plan.plan
            
            # Verificar si ya existe factura para este cliente en el periodo actual
            existing_invoice = (
                db.query(Invoice)
                .filter(Invoice.cliente_id == client.id, Invoice.periodo == periodo_actual)
                .first()
            )
            
            if existing_invoice:
                logger.info(f"El cliente {client.nombre} ya tiene una factura para el periodo {periodo_actual}.")
                continue
                
            # Crear factura
            fecha_emision = datetime.now()
            fecha_vencimiento = fecha_emision + timedelta(days=10) # 10 días para vencimiento
            
            # Calcular monto total: plan base + servicios personalizados
            active_custom_services = list(client.custom_services)
            monto_total = plan.precio + sum(cs.precio for cs in active_custom_services)
            
            new_invoice = Invoice(
                cliente_id=client.id,
                plan_id=plan.id,
                periodo=periodo_actual,
                monto=monto_total,
                fecha_emision=fecha_emision,
                fecha_vencimiento=fecha_vencimiento,
                estado="pendiente",
                custom_services=active_custom_services
            )
            
            # Remover servicios no recurrentes del cliente
            for cs in active_custom_services:
                if not cs.recurrente:
                    client.custom_services.remove(cs)
            
            db.add(new_invoice)
            invoices_created += 1
            logger.info(f"Factura generada para {client.nombre} — Periodo: {periodo_actual}, Monto: ${monto_total:.2f}")
            
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
        
        # Buscar facturas pendientes cuya fecha_vencimiento sea menor que ahora
        overdue_invoices = (
            db.query(Invoice)
            .filter(Invoice.estado == "pendiente", Invoice.fecha_vencimiento < now)
            .all()
        )
        
        updated_count = 0
        for invoice in overdue_invoices:
            invoice.estado = "vencido"
            updated_count += 1
            logger.info(f"Factura {invoice.id} del cliente {invoice.cliente_id} marcada como VENCIDA.")
            
        db.commit()
        logger.info(f"Verificación de vencimientos completada. Facturas marcadas como vencidas: {updated_count}")
        return {"status": "success", "updated_count": updated_count}
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error en check_overdue_invoices: {str(e)}", exc_info=True)
        return {"status": "error", "detail": str(e)}
    finally:
        db.close()
