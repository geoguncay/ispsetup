"""
Modelo SQLAlchemy: PPPoESecret
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PPPoESecret(Base):
    __tablename__ = "pppoe_secrets"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    ppp_username: Mapped[str] = mapped_column(String(100), nullable=False)
    ppp_password: Mapped[str] = mapped_column(String(255), nullable=False)  # Fernet cifrado
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("pppoe_profiles.id", ondelete="SET NULL"), nullable=True
    )
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

    # Restricción única: router + ppp_username (no puede haber dos usuarios ppp iguales en el mismo router)
    __table_args__ = (
        UniqueConstraint("gateway_id", "ppp_username", name="uq_gateway_ppp_username"),
    )

    # Relaciones
    client = relationship("Client", back_populates="pppoe_secret")
    gateway = relationship("Gateway", back_populates="pppoe_secrets")
    profile = relationship("PPPoEProfile", back_populates="pppoe_secrets")

    def __repr__(self) -> str:
        return f"<PPPoESecret id={self.id} usuario={self.ppp_username} gateway_id={self.gateway_id}>"
