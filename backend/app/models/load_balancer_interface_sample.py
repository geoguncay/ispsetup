"""
Modelo SQLAlchemy: LoadBalancerInterfaceSample — historial de estado/tráfico por
interfaz de un balanceador de carga (TODAS las interfaces, no solo las WAN
balanceadas — separado de TrafficSample porque ese modelo está orientado a
facturación/consumo por cliente).
"""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, PrimaryKeyConstraint, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LoadBalancerInterfaceSample(Base):
    __tablename__ = "lb_interface_samples"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), default=uuid.uuid4, nullable=False
    )
    load_balancer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("load_balancers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    interface_name: Mapped[str] = mapped_column(String(100), nullable=False)
    running: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rx_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    tx_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    rx_rate: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)  # bps
    tx_rate: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)  # bps
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # El particionamiento en PostgreSQL por rango requiere que la columna de partición
    # (timestamp) forme parte de la clave primaria (igual que TrafficSample).
    __table_args__ = (
        PrimaryKeyConstraint("id", "timestamp"),
        {
            "postgresql_partition_by": "RANGE (timestamp)",
        }
    )

    load_balancer = relationship("LoadBalancer")

    def __repr__(self) -> str:
        return (
            f"<LoadBalancerInterfaceSample lb={self.load_balancer_id} "
            f"iface={self.interface_name} running={self.running} ts={self.timestamp}>"
        )
