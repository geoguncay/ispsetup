"""
Modelo SQLAlchemy: StaticIP
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StaticIP(Base):
    __tablename__ = "static_ips"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    ip: Mapped[str] = mapped_column(String(45), nullable=False)
    mac: Mapped[str | None] = mapped_column(String(17), nullable=True)
    gateway_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("gateways.id", ondelete="CASCADE"), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Restricción única para evitar que la misma IP sea asignada en el mismo router
    __table_args__ = (
        UniqueConstraint("gateway_id", "ip", name="uq_gateway_ip"),
    )

    # Relaciones
    client = relationship("Client", back_populates="static_ip")
    gateway = relationship("Gateway")

    def __repr__(self) -> str:
        return f"<StaticIP id={self.id} ip={self.ip} gateway_id={self.gateway_id}>"
