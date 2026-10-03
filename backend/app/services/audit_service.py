"""
Servicio de auditoría: registra eventos del sistema ISP en la tabla audit_logs.
"""
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

# ── Acciones estándar ────────────────────────────────────────────────────────
class AuditAction:
    # Auth
    USER_LOGIN = "USER_LOGIN"
    USER_LOGIN_FAILED = "USER_LOGIN_FAILED"
    USER_LOGOUT = "USER_LOGOUT"
    USER_CREATE = "USER_CREATE"
    USER_UPDATE = "USER_UPDATE"
    USER_DELETE = "USER_DELETE"
    USER_AVATAR_UPDATE = "USER_AVATAR_UPDATE"

    # MikroTik
    CREATE_GATEWAY = "CREATE_GATEWAY"
    UPDATE_GATEWAY = "UPDATE_GATEWAY"
    DELETE_GATEWAY = "DELETE_GATEWAY"
    GATEWAY_ONLINE = "GATEWAY_ONLINE"
    GATEWAY_OFFLINE = "GATEWAY_OFFLINE"
    IMPORT_CLIENTS = "IMPORT_CLIENTS"
    TEST_GATEWAY_CONNECTION = "TEST_GATEWAY_CONNECTION"
    UPDATE_GATEWAY_QUEUE = "UPDATE_GATEWAY_QUEUE"
    SYNC_PPPOE_PROFILES = "SYNC_PPPOE_PROFILES"
    SYNC_GATEWAY = "SYNC_GATEWAY"
    TERMINATE_PPPOE_SESSION = "TERMINATE_PPPOE_SESSION"

    # Balanceadores de carga
    CREATE_LOAD_BALANCER = "CREATE_LOAD_BALANCER"
    UPDATE_LOAD_BALANCER = "UPDATE_LOAD_BALANCER"
    DELETE_LOAD_BALANCER = "DELETE_LOAD_BALANCER"
    TEST_LOAD_BALANCER_CONNECTION = "TEST_LOAD_BALANCER_CONNECTION"
    APPLY_LOAD_BALANCER_SCRIPT = "APPLY_LOAD_BALANCER_SCRIPT"

    # Clientes
    CREATE_CLIENT = "CREATE_CLIENT"
    UPDATE_CLIENT = "UPDATE_CLIENT"
    DELETE_CLIENT = "DELETE_CLIENT"
    SUSPEND_CLIENT = "SUSPEND_CLIENT"
    ACTIVATE_CLIENT = "ACTIVATE_CLIENT"
    SYNC_CLIENT = "SYNC_CLIENT"
    IMPORT_CLIENT_FILE = "IMPORT_CLIENT_FILE"
    CREATE_TICKET = "CREATE_TICKET"

    # Planes y colas
    ASSIGN_PLAN = "ASSIGN_PLAN"
    TOGGLE_QUEUE = "TOGGLE_QUEUE"
    CREATE_PLAN = "CREATE_PLAN"
    UPDATE_PLAN = "UPDATE_PLAN"
    DELETE_PLAN = "DELETE_PLAN"

    # Pagos
    CREATE_PAYMENT = "CREATE_PAYMENT"
    CREATE_INVOICE = "CREATE_INVOICE"
    UPDATE_INVOICE = "UPDATE_INVOICE"
    VOID_INVOICE = "VOID_INVOICE"
    DELETE_INVOICE = "DELETE_INVOICE"
    GENERATE_MONTHLY_INVOICES = "GENERATE_MONTHLY_INVOICES"
    MARK_INVOICES_OVERDUE = "MARK_INVOICES_OVERDUE"

    # Empresa y red
    UPDATE_COMPANY = "UPDATE_COMPANY"
    UPDATE_COMPANY_LOGO = "UPDATE_COMPANY_LOGO"
    UPDATE_LOGIN_BACKGROUND = "UPDATE_LOGIN_BACKGROUND"
    CREATE_SITE = "CREATE_SITE"
    UPDATE_SITE = "UPDATE_SITE"
    DELETE_SITE = "DELETE_SITE"

    # Catálogos comerciales
    CREATE_CUSTOM_SERVICE = "CREATE_CUSTOM_SERVICE"
    UPDATE_CUSTOM_SERVICE = "UPDATE_CUSTOM_SERVICE"
    DELETE_CUSTOM_SERVICE = "DELETE_CUSTOM_SERVICE"
    CREATE_SUPPLIER = "CREATE_SUPPLIER"
    UPDATE_SUPPLIER = "UPDATE_SUPPLIER"
    DELETE_SUPPLIER = "DELETE_SUPPLIER"
    CREATE_PRODUCT_CATEGORY = "CREATE_PRODUCT_CATEGORY"
    UPDATE_PRODUCT_CATEGORY = "UPDATE_PRODUCT_CATEGORY"
    CREATE_INVENTORY_ITEM = "CREATE_INVENTORY_ITEM"
    UPDATE_INVENTORY_ITEM = "UPDATE_INVENTORY_ITEM"
    DELETE_INVENTORY_ITEM = "DELETE_INVENTORY_ITEM"
    IMPORT_INVENTORY = "IMPORT_INVENTORY"

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
    UPDATE_MIKROTIK_API_SETTINGS = "UPDATE_MIKROTIK_API_SETTINGS"
    UPDATE_ISPSETUP_SETTINGS = "UPDATE_ISPSETUP_SETTINGS"

    # ZeroTier
    UPDATE_ZEROTIER_SETTINGS = "UPDATE_ZEROTIER_SETTINGS"
    AUTHORIZE_ZT_MEMBER = "AUTHORIZE_ZT_MEMBER"


# Entidad conceptual y descripción mínima para cada acción. Este catálogo también
# actúa como red de seguridad: un evento nunca se persiste con Entidad o Detalle
# vacíos aunque un llamador omita accidentalmente alguno de ellos.
ACTION_DEFAULTS: dict[str, tuple[str, str, str]] = {
    AuditAction.USER_LOGIN: ("User", "Usuario", "Inicio de sesión exitoso"),
    AuditAction.USER_LOGIN_FAILED: ("User", "Intento de acceso", "Inicio de sesión rechazado"),
    AuditAction.USER_LOGOUT: ("User", "Usuario", "Cierre de sesión"),
    AuditAction.USER_CREATE: ("User", "Usuario", "Usuario creado"),
    AuditAction.USER_UPDATE: ("User", "Usuario", "Usuario actualizado"),
    AuditAction.USER_DELETE: ("User", "Usuario", "Usuario eliminado"),
    AuditAction.USER_AVATAR_UPDATE: ("User", "Usuario", "Avatar actualizado"),
    AuditAction.CREATE_GATEWAY: ("Router", "Router", "Router creado"),
    AuditAction.UPDATE_GATEWAY: ("Router", "Router", "Router actualizado"),
    AuditAction.DELETE_GATEWAY: ("Router", "Router", "Router eliminado"),
    AuditAction.GATEWAY_ONLINE: ("Router", "Router", "Router en línea"),
    AuditAction.GATEWAY_OFFLINE: ("Router", "Router", "Router fuera de línea"),
    AuditAction.IMPORT_CLIENTS: ("Router", "Router", "Clientes importados desde el router"),
    AuditAction.TEST_GATEWAY_CONNECTION: ("Router", "Router", "Prueba de conexión ejecutada"),
    AuditAction.UPDATE_GATEWAY_QUEUE: ("Router", "Router", "Cola padre actualizada"),
    AuditAction.SYNC_PPPOE_PROFILES: ("Router", "Router", "Perfiles PPPoE sincronizados"),
    AuditAction.SYNC_GATEWAY: ("Router", "Router", "Sincronización con router ejecutada"),
    AuditAction.TERMINATE_PPPOE_SESSION: ("Router", "Router", "Sesión PPPoE terminada"),
    AuditAction.CREATE_LOAD_BALANCER: ("LoadBalancer", "Balanceador de carga", "Balanceador de carga creado"),
    AuditAction.UPDATE_LOAD_BALANCER: ("LoadBalancer", "Balanceador de carga", "Balanceador de carga actualizado"),
    AuditAction.DELETE_LOAD_BALANCER: ("LoadBalancer", "Balanceador de carga", "Balanceador de carga eliminado"),
    AuditAction.TEST_LOAD_BALANCER_CONNECTION: ("LoadBalancer", "Balanceador de carga", "Prueba de conexión ejecutada"),
    AuditAction.APPLY_LOAD_BALANCER_SCRIPT: ("LoadBalancer", "Balanceador de carga", "Script de balanceo ejecutado"),
    AuditAction.CREATE_CLIENT: ("Client", "Cliente", "Cliente creado"),
    AuditAction.UPDATE_CLIENT: ("Client", "Cliente", "Cliente actualizado"),
    AuditAction.DELETE_CLIENT: ("Client", "Cliente", "Cliente eliminado"),
    AuditAction.SUSPEND_CLIENT: ("Client", "Cliente", "Suspensión de cliente"),
    AuditAction.ACTIVATE_CLIENT: ("Client", "Cliente", "Activación de cliente"),
    AuditAction.SYNC_CLIENT: ("Client", "Cliente", "Cliente sincronizado con su router"),
    AuditAction.IMPORT_CLIENT_FILE: ("ClientImport", "Importación de clientes", "Archivo de clientes importado"),
    AuditAction.CREATE_TICKET: ("Ticket", "Ticket", "Ticket creado"),
    AuditAction.ASSIGN_PLAN: ("Client", "Cliente", "Plan asignado"),
    AuditAction.TOGGLE_QUEUE: ("Client", "Cliente", "Estado de cola modificado"),
    AuditAction.CREATE_PLAN: ("Plan", "Plan", "Plan creado"),
    AuditAction.UPDATE_PLAN: ("Plan", "Plan", "Plan actualizado"),
    AuditAction.DELETE_PLAN: ("Plan", "Plan", "Plan eliminado"),
    AuditAction.CREATE_PAYMENT: ("Payment", "Pago", "Pago registrado"),
    AuditAction.CREATE_INVOICE: ("Invoice", "Factura", "Factura creada"),
    AuditAction.UPDATE_INVOICE: ("Invoice", "Factura", "Factura editada"),
    AuditAction.VOID_INVOICE: ("Invoice", "Factura", "Factura anulada"),
    AuditAction.DELETE_INVOICE: ("Invoice", "Factura", "Factura eliminada"),
    AuditAction.GENERATE_MONTHLY_INVOICES: ("InvoiceBatch", "Facturación mensual", "Facturas mensuales generadas"),
    AuditAction.MARK_INVOICES_OVERDUE: ("InvoiceBatch", "Control de vencimientos", "Facturas vencidas actualizadas"),
    AuditAction.UPDATE_COMPANY: ("Company", "Empresa", "Datos de empresa actualizados"),
    AuditAction.UPDATE_COMPANY_LOGO: ("Company", "Empresa", "Logo de empresa actualizado"),
    AuditAction.UPDATE_LOGIN_BACKGROUND: ("Company", "Empresa", "Fondo de inicio de sesión actualizado"),
    AuditAction.CREATE_SITE: ("Site", "Sitio", "Sitio creado"),
    AuditAction.UPDATE_SITE: ("Site", "Sitio", "Sitio actualizado"),
    AuditAction.DELETE_SITE: ("Site", "Sitio", "Sitio eliminado"),
    AuditAction.CREATE_CUSTOM_SERVICE: ("CustomService", "Servicio personalizado", "Servicio creado"),
    AuditAction.UPDATE_CUSTOM_SERVICE: ("CustomService", "Servicio personalizado", "Servicio actualizado"),
    AuditAction.DELETE_CUSTOM_SERVICE: ("CustomService", "Servicio personalizado", "Servicio eliminado"),
    AuditAction.CREATE_SUPPLIER: ("Supplier", "Proveedor", "Proveedor creado"),
    AuditAction.UPDATE_SUPPLIER: ("Supplier", "Proveedor", "Proveedor actualizado"),
    AuditAction.DELETE_SUPPLIER: ("Supplier", "Proveedor", "Proveedor eliminado"),
    AuditAction.CREATE_PRODUCT_CATEGORY: ("ProductCategory", "Categoría", "Categoría creada"),
    AuditAction.UPDATE_PRODUCT_CATEGORY: ("ProductCategory", "Categoría", "Categoría actualizada"),
    AuditAction.CREATE_INVENTORY_ITEM: ("InventoryItem", "Artículo de inventario", "Artículo creado"),
    AuditAction.UPDATE_INVENTORY_ITEM: ("InventoryItem", "Artículo de inventario", "Artículo actualizado"),
    AuditAction.DELETE_INVENTORY_ITEM: ("InventoryItem", "Artículo de inventario", "Artículo eliminado"),
    AuditAction.IMPORT_INVENTORY: ("InventoryImport", "Importación de inventario", "Inventario importado"),
    AuditAction.UPDATE_LOCALIZATION_SETTINGS: ("SystemSettings", "Ajustes de localización", "Ajustes de localización actualizados"),
    AuditAction.UPDATE_FISCAL_SETTINGS: ("SystemSettings", "Ajustes fiscales", "Ajustes fiscales actualizados"),
    AuditAction.UPDATE_SMTP_SETTINGS: ("SystemSettings", "Ajustes de notificaciones", "Ajustes de notificaciones actualizados"),
    AuditAction.UPDATE_SECURITY_SETTINGS: ("SystemSettings", "Ajustes de seguridad", "Ajustes de seguridad actualizados"),
    AuditAction.UPDATE_MAINTENANCE_SETTINGS: ("SystemSettings", "Ajustes de mantenimiento", "Ajustes de mantenimiento actualizados"),
    AuditAction.UPDATE_INTEGRATION_SETTINGS: ("SystemSettings", "Ajustes de integraciones", "Ajustes de integraciones actualizados"),
    AuditAction.UPDATE_BILLING_SETTINGS: ("SystemSettings", "Ajustes de facturación", "Ajustes de facturación actualizados"),
    AuditAction.UPDATE_SUSPENSION_SETTINGS: ("SystemSettings", "Ajustes de suspensión", "Ajustes de suspensión actualizados"),
    AuditAction.UPDATE_CATALOG_SETTINGS: ("SystemSettings", "Ajustes de catálogos", "Ajustes de catálogos actualizados"),
    AuditAction.SYSTEM_BACKUP: ("SystemSettings", "Respaldo del sistema", "Respaldo generado"),
    AuditAction.UPDATE_MIKROTIK_API_SETTINGS: ("SystemSettings", "API MikroTik", "Credenciales API MikroTik actualizadas"),
    AuditAction.UPDATE_ISPSETUP_SETTINGS: ("SystemSettings", "Ajustes de ISPSETUP", "Ajustes de ISPSETUP actualizados"),
    AuditAction.UPDATE_ZEROTIER_SETTINGS: ("SystemSettings", "Ajustes de ZeroTier", "Ajustes de ZeroTier actualizados"),
    AuditAction.AUTHORIZE_ZT_MEMBER: ("ZeroTierMember", "Miembro de ZeroTier", "Miembro de ZeroTier autorizado"),
}

_SENSITIVE_PARTS = ("password", "secret", "token", "api_key", "auth", "credential")


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            key_str = str(key)
            if any(part in key_str.lower() for part in _SENSITIVE_PARTS):
                result[key_str] = "[PROTEGIDO]"
            else:
                result[key_str] = _json_safe(item)
        return result
    if isinstance(value, list | tuple | set):
        return [_json_safe(item) for item in value]
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, UUID | Decimal):
        return str(value)
    return value


def audit_detail(summary: str, *, changes: dict[str, Any] | None = None, **extra: Any) -> dict:
    """Construye un detalle consistente y elimina valores sensibles."""
    detail: dict[str, Any] = {"summary": summary}
    if changes:
        detail["changes"] = changes
    detail.update(extra)
    return _json_safe(detail)


def changed_fields(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Devuelve cambios reales en formato anterior/nuevo, listo para auditoría."""
    return {
        key: {"before": before.get(key), "after": value}
        for key, value in after.items()
        if before.get(key) != value
    }


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
        default_type, default_name, default_summary = ACTION_DEFAULTS.get(
            action, ("System", "Sistema", action.replace("_", " ").title())
        )
        safe_detail = _json_safe(detail) if detail else {"summary": default_summary}
        if not isinstance(safe_detail, dict):
            safe_detail = {"summary": default_summary, "value": safe_detail}
        if not safe_detail.get("summary"):
            safe_detail = {"summary": default_summary, **safe_detail}

        entry = AuditLog(
            action=action,
            entity_type=entity_type or default_type,
            entity_id=str(entity_id) if entity_id is not None else action.lower(),
            entity_name=entity_name or default_name,
            user_id=user_id,
            user_name=user_name,
            detail=safe_detail,
            ip_address=ip_address,
        )
        db.add(entry)
        db.commit()
    except Exception as exc:
        logger.error(f"Error al escribir audit log [{action}]: {exc}")
        db.rollback()


def log_connectivity_change(
    router_id: str, router_name: str, action: str, reason: str | None = None
) -> None:
    """
    Registra cambios de conectividad de un router (online/offline).
    `reason` distingue la causa cuando el router sale de línea:
    "offline" (RouterOS no responde) o "tunnel_down" (túnel ZeroTier caído).
    Abre su propia sesión de BD — seguro de llamar desde Celery workers.
    """
    from app.core.database import SessionLocal
    detail = {"source": "health_check"}
    if reason:
        detail["reason"] = reason
    db = SessionLocal()
    try:
        log_event(
            db=db,
            action=action,
            entity_type="Router",
            entity_id=router_id,
            entity_name=router_name,
            detail=detail,
        )
    finally:
        db.close()
