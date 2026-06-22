"""
Modelo SQLAlchemy: Invoice
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Uuid, func, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


invoice_custom_services_association = Table(
    "invoice_custom_services",
    Base.metadata,
    Column("invoice_id", Uuid(native_uuid=False), ForeignKey("invoices.id", ondelete="CASCADE"), primary_key=True),
    Column("custom_service_id", Uuid(native_uuid=False), ForeignKey("custom_services.id", ondelete="CASCADE"), primary_key=True),
)


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    cliente_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("plans.id", ondelete="SET NULL"), nullable=True
    )
    periodo: Mapped[str] = mapped_column(String(10), nullable=False)  # Formato "MM/AAAA", e.g., "06/2026"
    monto: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    fecha_emision: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    fecha_vencimiento: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    estado: Mapped[str] = mapped_column(String(20), nullable=False, default="pendiente")  # "pendiente", "pagado", "vencido"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relaciones
    client = relationship("Client", back_populates="invoices")
    plan = relationship("Plan")
    payments = relationship("ClientPayment", back_populates="invoice", cascade="all, delete-orphan")
    custom_services = relationship("CustomService", secondary=invoice_custom_services_association)

    def __repr__(self) -> str:
        return f"<Invoice id={self.id} cliente_id={self.cliente_id} periodo={self.periodo} monto={self.monto} estado={self.estado}>"
