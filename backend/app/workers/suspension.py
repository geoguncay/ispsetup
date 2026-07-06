"""
Tarea Celery: verificación diaria de mora y suspensión automática de clientes.
"""
import logging
from datetime import datetime, timedelta, timezone

from app.core import database
from app.core.security import decrypt_secret
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.invoice import Invoice
from app.models.suspension_log import SuspensionLog
from app.models.system_settings import SystemSettings
from app.services.mikrotik.address_list import suspend_ip_in_firewall, unsuspend_ip_in_firewall
from app.services.mikrotik.queue import toggle_client_queue
from app.services.mikrotik.pppoe import sync_pppoe_secret_in_gateway, disconnect_pppoe_session
from app.services.notifications.twilio_service import send_suspension_notification
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


@celery_app.task(name="app.workers.suspension.daily_suspension_check")
def daily_suspension_check():
    """
    Busca clientes activos con al menos una factura pendiente/vencida cuya due_date,
    más los días de gracia configurados (suspension_delay_days), ya se cumplió. Los suspende
    de forma automática en la base de datos, en MikroTik y les envía una notificación.
    Respeta el interruptor "Suspensión automática" (suspension_automatic) de Ajustes.
    """
    logger.info("Iniciando tarea diaria de verificación de suspensiones...")
    db = database.SessionLocal()
    try:
        cfg = _get_settings(db)

        if not cfg.suspension_automatic:
            logger.info("Suspensión automática desactivada en Ajustes. Tarea omitida.")
            return

        now = datetime.now(timezone.utc)
        grace_period = timedelta(days=cfg.suspension_delay_days or 0)

        # Buscar todos los clientes marcados como activos
        active_clients = db.query(Client).filter(Client.active == True).all()
        logger.info(f"Se encontraron {len(active_clients)} clientes activos para revisar.")

        suspended_count = 0

        for client in active_clients:
            # Factura impaga más antigua del cliente (pendiente o ya marcada como vencida)
            overdue_invoice = (
                db.query(Invoice)
                .filter(Invoice.client_id == client.id, Invoice.status.in_(("pending", "overdue")))
                .order_by(Invoice.due_date.asc())
                .first()
            )

            if not overdue_invoice:
                continue

            due = overdue_invoice.due_date
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)

            if now < due + grace_period:
                continue

            reason = (
                f"Mora de pago: factura del periodo {overdue_invoice.period} "
                f"vencida el {due.strftime('%Y-%m-%d')} (gracia de {cfg.suspension_delay_days} días cumplida)"
            )

            logger.info(f"Cliente {client.name} ({client.id}) califica para suspensión. Razón: {reason}")
            try:
                # 1. Desactivar cliente
                client.active = False

                # 2. Desactivar plan activo
                active_plan = (
                    db.query(ClientPlan)
                    .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
                    .first()
                )
                if active_plan:
                    active_plan.estado = "suspendido"

                # 3. Aplicar suspensión en MikroTik (según tipo de conexión)
                if client.connection_type == "static" and client.static_ip:
                    suspend_ip_in_firewall(client.gateway, client.static_ip.ip, client.name)
                    toggle_client_queue(client.gateway, client.static_ip.ip, disabled=True)
                elif client.connection_type == "pppoe" and client.pppoe_secret:
                    password_dec = decrypt_secret(client.pppoe_secret.ppp_password)
                    profile_name = client.pppoe_secret.profile.name if client.pppoe_secret.profile else "default"
                    sync_pppoe_secret_in_gateway(
                        gateway=client.gateway,
                        username=client.pppoe_secret.ppp_username,
                        password=password_dec,
                        profile_name=profile_name,
                        client_name=client.name,
                        disabled=True
                    )
                    disconnect_pppoe_session(client.gateway, client.pppoe_secret.ppp_username)

                # 4. Crear log de suspensión
                log = SuspensionLog(
                    client_id=client.id,
                    reason=reason,
                    suspended_at=datetime.now(),
                    user_id=None  # Nulo indica acción del sistema (automático)
                )
                db.add(log)

                # Guardar cambios del cliente actual
                db.commit()
                suspended_count += 1
                logger.info(f"Cliente {client.name} suspendido exitosamente por el sistema.")

                # 5. Enviar notificación por Twilio (no bloqueante, respeta el ajuste de notificaciones)
                if cfg.suspension_notify_suspended:
                    try:
                        send_suspension_notification(client.name, client.phone, is_suspension=True)
                    except Exception as e:
                        logger.warning(f"Error al enviar notificación de suspensión automática a {client.name}: {e}")

            except Exception as e:
                db.rollback()
                logger.error(f"Error al intentar suspender automáticamente al cliente {client.name}: {e}", exc_info=True)

        logger.info(f"Tarea de verificación completada. Clientes suspendidos en esta ejecución: {suspended_count}")

    except Exception as exc:
        logger.error(f"Error general en la tarea daily_suspension_check: {exc}", exc_info=True)
    finally:
        db.close()


@celery_app.task(name="app.workers.suspension.process_scheduled_suspensions")
def process_scheduled_suspensions():
    """
    Busca clientes activos con una suspensión aplazada (scheduled_suspension)
    cuya fecha ya se cumplió y los suspende automáticamente en la base de datos,
    en MikroTik y les envía una notificación.
    """
    logger.info("Verificando suspensiones aplazadas...")
    db = database.SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        pending_clients = (
            db.query(Client)
            .filter(Client.active == True, Client.scheduled_suspension.isnot(None), Client.scheduled_suspension <= now)
            .all()
        )
        logger.info(f"Se encontraron {len(pending_clients)} clientes con suspensión aplazada vencida.")

        suspended_count = 0

        for client in pending_clients:
            reason = client.scheduled_suspension_reason or "Suspensión aplazada"
            try:
                client.active = False
                client.scheduled_suspension = None
                client.scheduled_suspension_reason = None

                active_plan = (
                    db.query(ClientPlan)
                    .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
                    .first()
                )
                if active_plan:
                    active_plan.estado = "suspendido"

                if client.connection_type == "static" and client.static_ip:
                    suspend_ip_in_firewall(client.gateway, client.static_ip.ip, client.name)
                    toggle_client_queue(client.gateway, client.static_ip.ip, disabled=True)
                elif client.connection_type == "pppoe" and client.pppoe_secret:
                    password_dec = decrypt_secret(client.pppoe_secret.ppp_password)
                    profile_name = client.pppoe_secret.profile.name if client.pppoe_secret.profile else "default"
                    sync_pppoe_secret_in_gateway(
                        gateway=client.gateway,
                        username=client.pppoe_secret.ppp_username,
                        password=password_dec,
                        profile_name=profile_name,
                        client_name=client.name,
                        disabled=True
                    )
                    disconnect_pppoe_session(client.gateway, client.pppoe_secret.ppp_username)

                log = SuspensionLog(
                    client_id=client.id,
                    reason=reason,
                    suspended_at=datetime.now(),
                    user_id=None  # Nulo indica acción del sistema (automático)
                )
                db.add(log)

                db.commit()
                suspended_count += 1
                logger.info(f"Cliente {client.name} suspendido automáticamente por aplazamiento vencido.")

                try:
                    send_suspension_notification(client.name, client.phone, is_suspension=True)
                except Exception as e:
                    logger.warning(f"Error al enviar notificación de suspensión aplazada a {client.name}: {e}")

            except Exception as e:
                db.rollback()
                logger.error(f"Error al intentar suspender automáticamente al cliente {client.name} (aplazamiento): {e}", exc_info=True)

        logger.info(f"Tarea de suspensiones aplazadas completada. Clientes suspendidos: {suspended_count}")

    except Exception as exc:
        logger.error(f"Error general en la tarea process_scheduled_suspensions: {exc}", exc_info=True)
    finally:
        db.close()


@celery_app.task(name="app.workers.suspension.process_scheduled_reactivations")
def process_scheduled_reactivations():
    """
    Busca clientes suspendidos con una reactivación programada (scheduled_reactivation)
    cuya fecha ya se cumplió y los reactiva automáticamente en la base de datos,
    en MikroTik y les envía una notificación.
    """
    logger.info("Verificando reactivaciones programadas...")
    db = database.SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        pending_clients = (
            db.query(Client)
            .filter(Client.active == False, Client.scheduled_reactivation.isnot(None), Client.scheduled_reactivation <= now)
            .all()
        )
        logger.info(f"Se encontraron {len(pending_clients)} clientes con reactivación programada vencida.")

        reactivated_count = 0

        for client in pending_clients:
            try:
                client.active = True
                client.scheduled_reactivation = None

                suspended_plan = (
                    db.query(ClientPlan)
                    .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "suspendido")
                    .first()
                )
                if suspended_plan:
                    suspended_plan.estado = "activo"

                if client.connection_type == "static" and client.static_ip:
                    unsuspend_ip_in_firewall(client.gateway, client.static_ip.ip)
                    toggle_client_queue(client.gateway, client.static_ip.ip, disabled=False)
                elif client.connection_type == "pppoe" and client.pppoe_secret:
                    password_dec = decrypt_secret(client.pppoe_secret.ppp_password)
                    profile_name = client.pppoe_secret.profile.name if client.pppoe_secret.profile else "default"
                    sync_pppoe_secret_in_gateway(
                        gateway=client.gateway,
                        username=client.pppoe_secret.ppp_username,
                        password=password_dec,
                        profile_name=profile_name,
                        client_name=client.name,
                        disabled=False
                    )

                log = (
                    db.query(SuspensionLog)
                    .filter(SuspensionLog.client_id == client.id, SuspensionLog.reactivated_at == None)
                    .order_by(SuspensionLog.suspended_at.desc())
                    .first()
                )
                if log:
                    log.reactivated_at = datetime.now()

                db.commit()
                reactivated_count += 1
                logger.info(f"Cliente {client.name} reactivado automáticamente por reactivación programada.")

                try:
                    send_suspension_notification(client.name, client.phone, is_suspension=False)
                except Exception as e:
                    logger.warning(f"Error al enviar notificación de reactivación automática a {client.name}: {e}")

            except Exception as e:
                db.rollback()
                logger.error(f"Error al intentar reactivar automáticamente al cliente {client.name}: {e}", exc_info=True)

        logger.info(f"Tarea de reactivaciones programadas completada. Clientes reactivados: {reactivated_count}")

    except Exception as exc:
        logger.error(f"Error general en la tarea process_scheduled_reactivations: {exc}", exc_info=True)
    finally:
        db.close()
