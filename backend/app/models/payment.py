"""
Modelo SQLAlchemy: ClientPayment
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClientPayment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    cliente_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("clients.id"), nullable=False
    )
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True
    )
    usuario_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    monto: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    fecha_pago: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    metodo: Mapped[str] = mapped_column(String(50), nullable=False)  # "efectivo", "transferencia", "tarjeta", "deposito"
    estado: Mapped[str] = mapped_column(String(20), nullable=False, default="completado")  # "completado", "pendiente", "fallido"
    notas: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relaciones
    client = relationship("Client", back_populates="payments")
    invoice = relationship("Invoice", back_populates="payments")
    usuario = relationship("User")

    def __repr__(self) -> str:
        return f"<ClientPayment id={self.id} cliente_id={self.cliente_id} invoice_id={self.invoice_id} monto={self.monto} estado={self.estado}>"
