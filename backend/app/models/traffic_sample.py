"""
Modelo SQLAlchemy: TrafficSample
"""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, PrimaryKeyConstraint, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TrafficSample(Base):
    __tablename__ = "traffic_samples"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), default=uuid.uuid4, nullable=False
    )
    router_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("routers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True
    )
    interface_name: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )
    rx_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tx_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    # Volumen transferido desde la muestra anterior. A diferencia de rx_bytes/tx_bytes,
    # estos valores no son contadores acumulados del router y se pueden sumar.
    rx_delta_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tx_delta_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    rx_rate: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)  # bps
    tx_rate: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)  # bps
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # El particionamiento en PostgreSQL por rango requiere que la columna de partición (timestamp)
    # forme parte de la clave primaria.
    __table_args__ = (
        PrimaryKeyConstraint("id", "timestamp"),
        {
            "postgresql_partition_by": "RANGE (timestamp)",
        }
    )

    # Relaciones
    router = relationship("Router")
    client = relationship("Client")

    def __repr__(self) -> str:
        client_part = f"client={self.client_id}" if self.client_id else f"iface={self.interface_name}"
        return f"<TrafficSample id={self.id} {client_part} rx_rate={self.rx_rate} tx_rate={self.tx_rate} ts={self.timestamp}>"
