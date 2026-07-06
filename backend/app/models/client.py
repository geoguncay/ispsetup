"""
Modelo SQLAlchemy: Client
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Uuid, func, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


client_custom_services_association = Table(
    "client_custom_services",
    Base.metadata,
    Column("client_id", Uuid(native_uuid=False), ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True),
    Column("custom_service_id", Uuid(native_uuid=False), ForeignKey("custom_services.id", ondelete="CASCADE"), primary_key=True),
)


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    last_name: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    first_name: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    cedula: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    address: Mapped[str] = mapped_column(String(255), nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gateway_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("gateways.id"), nullable=False
    )
    connection_type: Mapped[str] = mapped_column(String(20), nullable=False, default="static")  # "static" o "pppoe"
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    billing_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    billing_period_start_day: Mapped[int] = mapped_column(default=1)
    invoice_advance_days: Mapped[int] = mapped_column(default=0)
    billing_type: Mapped[str] = mapped_column(String(20), default="forward")
    auto_apply_payment: Mapped[bool] = mapped_column(Boolean, default=True)
    use_auto_credit: Mapped[bool] = mapped_column(Boolean, default=True)
    separate_proration: Mapped[bool] = mapped_column(Boolean, default=True)
    scheduled_suspension: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduled_suspension_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    scheduled_reactivation: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relaciones
    gateway = relationship("Gateway")
    client_plans = relationship("ClientPlan", back_populates="client", cascade="all, delete-orphan")
    static_ip = relationship("StaticIP", back_populates="client", uselist=False, cascade="all, delete-orphan")
    pppoe_secret = relationship("PPPoESecret", back_populates="client", uselist=False, cascade="all, delete-orphan")
    payments = relationship("ClientPayment", back_populates="client", cascade="all, delete-orphan")
    invoices = relationship("Invoice", back_populates="client", cascade="all, delete-orphan")
    tickets = relationship("ClientTicket", back_populates="client", cascade="all, delete-orphan")
    custom_services = relationship("CustomService", secondary=client_custom_services_association)
    inventory_items = relationship("ClientInventoryItem", back_populates="client", cascade="all, delete-orphan")

    @property
    def site_id(self) -> uuid.UUID | None:
        return self.gateway.site_id if self.gateway else None

    @property
    def site_name(self) -> str | None:
        return self.gateway.site.name if (self.gateway and self.gateway.site) else None

    def __repr__(self) -> str:
        return f"<Client id={self.id} name={self.name} cedula={self.cedula}>"

