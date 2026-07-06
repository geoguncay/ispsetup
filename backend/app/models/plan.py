"""
Modelo SQLAlchemy: Plan
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    speed_down_mbps: Mapped[int] = mapped_column(Integer, nullable=False)
    speed_up_mbps: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    taxes: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.0)
    speed_down_kbps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    speed_up_kbps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    limit_at_up_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    limit_at_down_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    burst_threshold_up_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    burst_threshold_down_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    priority: Mapped[int | None] = mapped_column(Integer, nullable=True, default=8)
    address_list: Mapped[str | None] = mapped_column(String(100), nullable=True)
    parent: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relación a ClientPlan
    client_plans = relationship("ClientPlan", back_populates="plan", cascade="all, delete-orphan")

    @property
    def active_clients(self) -> int:
        return sum(1 for cp in self.client_plans if cp.estado == "activo")

    @property
    def suspended_clients(self) -> int:
        return sum(1 for cp in self.client_plans if cp.estado == "suspendido")

    def __repr__(self) -> str:
        return f"<Plan id={self.id} name={self.name} price={self.price}>"
