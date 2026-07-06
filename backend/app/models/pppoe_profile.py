"""
Modelo SQLAlchemy: PPPoEProfile
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PPPoEProfile(Base):
    __tablename__ = "pppoe_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    speed_down_mbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speed_up_mbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gateway_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("gateways.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Restricción única: router + nombre del perfil
    __table_args__ = (
        UniqueConstraint("gateway_id", "name", name="uq_gateway_profile_name"),
    )

    # Relaciones
    gateway = relationship("Gateway", back_populates="pppoe_profiles")
    pppoe_secrets = relationship("PPPoESecret", back_populates="profile")

    def __repr__(self) -> str:
        return f"<PPPoEProfile id={self.id} name={self.name} gateway_id={self.gateway_id}>"
