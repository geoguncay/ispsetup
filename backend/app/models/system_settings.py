"""
Modelo SQLAlchemy: SystemSettings (singleton — siempre un único registro).
"""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )

    # MikroTik API
    mikrotik_timeout: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    mikrotik_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    mikrotik_debug: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mikrotik_ssl: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Localización
    loc_timezone: Mapped[str] = mapped_column(String(60), nullable=False, default="UTC")
    loc_locale: Mapped[str] = mapped_column(String(10), nullable=False, default="es")
    loc_currency_code: Mapped[str] = mapped_column(String(10), nullable=False, default="USD")
    loc_currency_symbol: Mapped[str] = mapped_column(String(5), nullable=False, default="$")
    loc_date_format: Mapped[str] = mapped_column(String(20), nullable=False, default="DD/MM/YYYY")

    # Fiscal
    fiscal_tax_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    fiscal_tax_name: Mapped[str] = mapped_column(String(20), nullable=False, default="IVA")
    fiscal_invoice_prefix: Mapped[str] = mapped_column(String(20), nullable=False, default="FAC-")
    fiscal_invoice_next_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Notificaciones (SMTP — solo configuración, sin envío real en esta fase)
    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True, default=587)
    smtp_user: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    smtp_from_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_from_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sms_notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Seguridad
    sec_password_min_length: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    sec_password_expiration_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sec_default_session_timeout_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    sec_max_login_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    sec_lockout_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    sec_ip_whitelist: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Mantenimiento
    maint_audit_log_retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    maint_maintenance_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    maint_maintenance_message: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Integraciones (pasarela de pago)
    pg_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pg_api_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Facturación 
    billing_generation_time: Mapped[str] = mapped_column(String(5), nullable=False, default="08:00")
    billing_cycle: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")
    billing_price_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="included")
    billing_auto_approve_send: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    billing_stop_suspended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    billing_notify_new_invoice: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    billing_attach_pdf_receipt: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    billing_default_payment_day: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    billing_default_grace_days: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    
    # Cómo se genera la factura: "fixed_day" (día fijo del mes, billing_default_payment_day) o
    # "cutoff_day" (día de corte del cliente, billing_period_start_day).
    billing_generation_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed_day")

    # Cómo se determina la fecha de vencimiento de la factura: "fixed_term" (plazo fijo, billing_default_grace_days)
    # o "cutoff_term" (plazo desde el día de corte del cliente, billing_period_start_day + billing_default_grace_days).
    billing_due_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed_term")
    
    # Hora del día en que vence la factura: "start_of_day" (00:00:00) o "end_of_day" (23:59:59).
    billing_due_time: Mapped[str] = mapped_column(String(20), nullable=False, default="end_of_day")
    billing_advance_notice_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    billing_advance_notice_days: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    billing_payment_reminders: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    billing_reminder_frequency_days: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # Suspensión automática de clientes morosos
    suspension_automatic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    suspension_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    suspension_delay_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    suspension_allow_deferral: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    suspension_notify_suspended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    suspension_notify_deferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    suspension_reasons: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Catálogos
    payment_methods: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cutoff_dates: Mapped[list | None] = mapped_column(JSON, nullable=True)
    parent_queues: Mapped[list | None] = mapped_column(JSON, nullable=True)
    address_lists: Mapped[list | None] = mapped_column(JSON, nullable=True)
    suspend_lists: Mapped[list | None] = mapped_column(JSON, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<SystemSettings timeout={self.mikrotik_timeout} ssl={self.mikrotik_ssl}>"
