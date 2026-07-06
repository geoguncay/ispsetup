"""
Servicio de auditoría: registra eventos del sistema ISP en la tabla audit_logs.
"""
import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

# ── Acciones estándar ────────────────────────────────────────────────────────
class AuditAction:
    # Auth
    USER_LOGIN = "USER_LOGIN"

    # Gateways
    CREATE_GATEWAY = "CREATE_GATEWAY"
    UPDATE_GATEWAY = "UPDATE_GATEWAY"
    DELETE_GATEWAY = "DELETE_GATEWAY"
    GATEWAY_ONLINE = "GATEWAY_ONLINE"
    GATEWAY_OFFLINE = "GATEWAY_OFFLINE"
    IMPORT_CLIENTS = "IMPORT_CLIENTS"

    # Clientes
    CREATE_CLIENT = "CREATE_CLIENT"
    UPDATE_CLIENT = "UPDATE_CLIENT"
    DELETE_CLIENT = "DELETE_CLIENT"
    SUSPEND_CLIENT = "SUSPEND_CLIENT"
    ACTIVATE_CLIENT = "ACTIVATE_CLIENT"

    # Planes y colas
    ASSIGN_PLAN = "ASSIGN_PLAN"
    TOGGLE_QUEUE = "TOGGLE_QUEUE"

    # Pagos
    CREATE_PAYMENT = "CREATE_PAYMENT"

    # Ajustes de Sistema
    UPDATE_LOCALIZATION_SETTINGS = "UPDATE_LOCALIZATION_SETTINGS"
    UPDATE_FISCAL_SETTINGS = "UPDATE_FISCAL_SETTINGS"
    UPDATE_SMTP_SETTINGS = "UPDATE_SMTP_SETTINGS"
    UPDATE_SECURITY_SETTINGS = "UPDATE_SECURITY_SETTINGS"
    UPDATE_MAINTENANCE_SETTINGS = "UPDATE_MAINTENANCE_SETTINGS"
    UPDATE_INTEGRATION_SETTINGS = "UPDATE_INTEGRATION_SETTINGS"
    UPDATE_BILLING_SETTINGS = "UPDATE_BILLING_SETTINGS"
    UPDATE_SUSPENSION_SETTINGS = "UPDATE_SUSPENSION_SETTINGS"
    UPDATE_CATALOG_SETTINGS = "UPDATE_CATALOG_SETTINGS"
    SYSTEM_BACKUP = "SYSTEM_BACKUP"


def log_event(
    db: Session,
    action: str,
    entity_type: str | None = None,
    entity_id: Any = None,
    entity_name: str | None = None,
    user_id: Any = None,
    user_name: str | None = None,
    detail: dict | None = None,
    ip_address: str | None = None,
) -> None:
    """
    Escribe un evento de auditoría en la BD.
    No lanza excepciones — los errores se registran en el log del sistema.
    """
    try:
        entry = AuditLog(
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            entity_name=entity_name,
            user_id=user_id,
            user_name=user_name,
            detail=detail,
            ip_address=ip_address,
        )
        db.add(entry)
        db.commit()
    except Exception as exc:
        logger.error(f"Error al escribir audit log [{action}]: {exc}")
        db.rollback()


def log_connectivity_change(gateway_id: str, gateway_name: str, action: str) -> None:
    """
    Registra cambios de conectividad de un gateway (online/offline).
    Abre su propia sesión de BD — seguro de llamar desde Celery workers.
    """
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        log_event(
            db=db,
            action=action,
            entity_type="Gateway",
            entity_id=gateway_id,
            entity_name=gateway_name,
            detail={"source": "health_check"},
        )
    finally:
        db.close()
