"""
Endpoints para configuración global del sistema (SystemSettings).
"""
import os
import subprocess
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.core.database import _is_sqlite
from app.core.deps import AdminOnly, CurrentUser, DBSession
from app.core.security import encrypt_secret
from app.models.system_settings import SystemSettings
from app.schemas.system_settings import (
    BackupResult,
    BillingDueDateSettingsRead,
    BillingSettings,
    BillingSettingsRead,
    CatalogSettings,
    CatalogSettingsRead,
    FiscalSettings,
    FiscalSettingsRead,
    IntegrationSettings,
    IntegrationSettingsRead,
    LocalizationSettings,
    LocalizationSettingsRead,
    MaintenanceSettings,
    MaintenanceSettingsRead,
    MikrotikApiConfig,
    MikrotikApiConfigRead,
    SecuritySettings,
    SecuritySettingsRead,
    SmtpSettings,
    SmtpSettingsRead,
    SuspensionSettings,
    SuspensionSettingsRead,
    SystemSettingsRead,
)
from app.services.audit_service import AuditAction, log_event
from app.services.mikrotik.gateway_pool import gateway_pool

router = APIRouter(prefix="/settings", tags=["settings"])


def _get_or_create(db) -> SystemSettings:
    cfg = db.query(SystemSettings).first()
    if not cfg:
        cfg = SystemSettings()
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@router.get("/mikrotik-api", response_model=MikrotikApiConfigRead)
def get_mikrotik_api_config(db: DBSession, _: AdminOnly) -> SystemSettings:
    return _get_or_create(db)


@router.put("/mikrotik-api", response_model=MikrotikApiConfigRead)
def update_mikrotik_api_config(
    payload: MikrotikApiConfig,
    db: DBSession,
    _: AdminOnly,
) -> SystemSettings:
    cfg = _get_or_create(db)
    cfg.mikrotik_timeout = payload.mikrotik_timeout
    cfg.mikrotik_attempts = payload.mikrotik_attempts
    cfg.mikrotik_debug = payload.mikrotik_debug
    cfg.mikrotik_ssl = payload.mikrotik_ssl
    db.commit()
    db.refresh(cfg)
    gateway_pool.invalidate_config_cache()
    return cfg


# ── Lectura agregada de Ajustes de Sistema ──────────────────────────────────
def _to_smtp_read(cfg: SystemSettings) -> SmtpSettingsRead:
    return SmtpSettingsRead(
        smtp_host=cfg.smtp_host,
        smtp_port=cfg.smtp_port,
        smtp_user=cfg.smtp_user,
        smtp_password_set=bool(cfg.smtp_password_encrypted),
        smtp_from_email=cfg.smtp_from_email,
        smtp_from_name=cfg.smtp_from_name,
        smtp_use_tls=cfg.smtp_use_tls,
        sms_notifications_enabled=cfg.sms_notifications_enabled,
    )


def _to_security_read(cfg: SystemSettings) -> SecuritySettingsRead:
    return SecuritySettingsRead(
        sec_password_min_length=cfg.sec_password_min_length,
        sec_password_expiration_days=cfg.sec_password_expiration_days,
        sec_default_session_timeout_minutes=cfg.sec_default_session_timeout_minutes,
        sec_max_login_attempts=cfg.sec_max_login_attempts,
        sec_lockout_duration_minutes=cfg.sec_lockout_duration_minutes,
        sec_ip_whitelist=cfg.sec_ip_whitelist or [],
    )


def _to_integrations_read(cfg: SystemSettings) -> IntegrationSettingsRead:
    return IntegrationSettingsRead(
        pg_api_key=cfg.pg_api_key,
        pg_api_secret_set=bool(cfg.pg_api_secret_encrypted),
    )


def _to_suspension_read(cfg: SystemSettings) -> SuspensionSettingsRead:
    return SuspensionSettingsRead(
        suspension_automatic=cfg.suspension_automatic,
        suspension_hour=cfg.suspension_hour,
        suspension_delay_days=cfg.suspension_delay_days,
        suspension_allow_deferral=cfg.suspension_allow_deferral,
        suspension_notify_suspended=cfg.suspension_notify_suspended,
        suspension_notify_deferred=cfg.suspension_notify_deferred,
        suspension_reasons=cfg.suspension_reasons or [],
    )


def _to_catalogs_read(cfg: SystemSettings) -> CatalogSettingsRead:
    return CatalogSettingsRead(
        payment_methods=cfg.payment_methods or [],
        cutoff_dates=cfg.cutoff_dates or [],
        parent_queues=cfg.parent_queues or [],
        address_lists=cfg.address_lists or [],
        suspend_lists=cfg.suspend_lists or ["isp_suspendidos"],
    )


@router.get("/localization", response_model=LocalizationSettingsRead)
def get_localization_settings(db: DBSession, _: CurrentUser) -> LocalizationSettingsRead:
    """Configuración de localización (formato de fecha, moneda, zona horaria) para cualquier usuario autenticado."""
    cfg = _get_or_create(db)
    return LocalizationSettingsRead.model_validate(cfg)


@router.get("/billing-due-date", response_model=BillingDueDateSettingsRead)
def get_billing_due_date_settings(db: DBSession, _: CurrentUser) -> BillingDueDateSettingsRead:
    """Reglas de cálculo de vencimiento de facturas, para cualquier usuario autenticado (usado por el simulador de facturación del formulario de cliente)."""
    cfg = _get_or_create(db)
    return BillingDueDateSettingsRead.model_validate(cfg)


@router.get("/catalogs", response_model=CatalogSettingsRead)
def get_catalog_settings(db: DBSession, _: CurrentUser) -> CatalogSettingsRead:
    """Catálogos (métodos de pago, fechas de corte, etc.) para cualquier usuario autenticado (usado por el formulario de cliente)."""
    cfg = _get_or_create(db)
    return _to_catalogs_read(cfg)


@router.get("/system", response_model=SystemSettingsRead)
def get_system_settings(db: DBSession, _: AdminOnly) -> SystemSettingsRead:
    cfg = _get_or_create(db)
    return SystemSettingsRead(
        localization=LocalizationSettingsRead.model_validate(cfg),
        fiscal=FiscalSettingsRead.model_validate(cfg),
        notifications=_to_smtp_read(cfg),
        security=_to_security_read(cfg),
        maintenance=MaintenanceSettingsRead.model_validate(cfg),
        integrations=_to_integrations_read(cfg),
        billing=BillingSettingsRead.model_validate(cfg),
        suspension=_to_suspension_read(cfg),
        catalogs=_to_catalogs_read(cfg),
        updated_at=cfg.updated_at,
    )


@router.put("/system/localization", response_model=LocalizationSettingsRead)
def update_localization_settings(
    payload: LocalizationSettings, db: DBSession, current_user: AdminOnly
) -> LocalizationSettingsRead:
    cfg = _get_or_create(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_LOCALIZATION_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return LocalizationSettingsRead.model_validate(cfg)


@router.put("/system/fiscal", response_model=FiscalSettingsRead)
def update_fiscal_settings(
    payload: FiscalSettings, db: DBSession, current_user: AdminOnly
) -> FiscalSettingsRead:
    cfg = _get_or_create(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_FISCAL_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return FiscalSettingsRead.model_validate(cfg)


@router.put("/system/notifications", response_model=SmtpSettingsRead)
def update_notification_settings(
    payload: SmtpSettings, db: DBSession, current_user: AdminOnly
) -> SmtpSettingsRead:
    cfg = _get_or_create(db)
    data = payload.model_dump(exclude_unset=True, exclude={"smtp_password"})
    for field, value in data.items():
        setattr(cfg, field, value)
    if "smtp_password" in payload.model_fields_set:
        cfg.smtp_password_encrypted = (
            encrypt_secret(payload.smtp_password) if payload.smtp_password else None
        )
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_SMTP_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return _to_smtp_read(cfg)


@router.put("/system/security", response_model=SecuritySettingsRead)
def update_security_settings(
    payload: SecuritySettings, db: DBSession, current_user: AdminOnly
) -> SecuritySettingsRead:
    cfg = _get_or_create(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_SECURITY_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return _to_security_read(cfg)


@router.put("/system/maintenance", response_model=MaintenanceSettingsRead)
def update_maintenance_settings(
    payload: MaintenanceSettings, db: DBSession, current_user: AdminOnly
) -> MaintenanceSettingsRead:
    cfg = _get_or_create(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_MAINTENANCE_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return MaintenanceSettingsRead.model_validate(cfg)


@router.put("/system/integrations", response_model=IntegrationSettingsRead)
def update_integration_settings(
    payload: IntegrationSettings, db: DBSession, current_user: AdminOnly
) -> IntegrationSettingsRead:
    cfg = _get_or_create(db)
    if "pg_api_key" in payload.model_fields_set:
        cfg.pg_api_key = payload.pg_api_key
    if "pg_api_secret" in payload.model_fields_set:
        cfg.pg_api_secret_encrypted = (
            encrypt_secret(payload.pg_api_secret) if payload.pg_api_secret else None
        )
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_INTEGRATION_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return _to_integrations_read(cfg)


@router.put("/system/billing", response_model=BillingSettingsRead)
def update_billing_settings(
    payload: BillingSettings, db: DBSession, current_user: AdminOnly
) -> BillingSettingsRead:
    cfg = _get_or_create(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_BILLING_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return BillingSettingsRead.model_validate(cfg)


@router.put("/system/suspension", response_model=SuspensionSettingsRead)
def update_suspension_settings(
    payload: SuspensionSettings, db: DBSession, current_user: AdminOnly
) -> SuspensionSettingsRead:
    cfg = _get_or_create(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_SUSPENSION_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return _to_suspension_read(cfg)


@router.put("/system/catalogs", response_model=CatalogSettingsRead)
def update_catalog_settings(
    payload: CatalogSettings, db: DBSession, current_user: AdminOnly
) -> CatalogSettingsRead:
    cfg = _get_or_create(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    log_event(
        db, AuditAction.UPDATE_CATALOG_SETTINGS,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
    )
    return _to_catalogs_read(cfg)


@router.post("/system/backup", response_model=BackupResult)
def run_manual_backup(db: DBSession, current_user: AdminOnly) -> BackupResult:
    if _is_sqlite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El backup manual requiere PostgreSQL; la base actual es SQLite.",
        )
    os.makedirs(settings.BACKUP_DIR, exist_ok=True)
    created_at = datetime.now(timezone.utc)
    filename = f"isp_backup_{created_at.strftime('%Y%m%d_%H%M%S')}.sql"
    file_path = os.path.join(settings.BACKUP_DIR, filename)
    try:
        result = subprocess.run(
            ["pg_dump", settings.DATABASE_URL, "-f", file_path],
            capture_output=True, text=True, timeout=300,
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="pg_dump no está disponible en el servidor.",
        )
    if result.returncode != 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al generar el backup: {result.stderr.strip()}",
        )
    size_bytes = os.path.getsize(file_path)
    log_event(
        db, AuditAction.SYSTEM_BACKUP,
        entity_type="SystemSettings",
        user_id=current_user.id, user_name=current_user.name,
        detail={"filename": filename, "size_bytes": size_bytes},
    )
    return BackupResult(filename=filename, size_bytes=size_bytes, created_at=created_at)
