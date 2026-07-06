"""
Modelo SQLAlchemy: Gateway (anteriormente Router)
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Gateway(Base):
    __tablename__ = "gateways"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Nota: Almacena cualquier dirección IP o host de red (LAN, WAN, VPN, Tailscale, ZeroTier, etc.).
    ip: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    api_port: Mapped[int] = mapped_column(Integer, nullable=False, default=8728)
    api_username: Mapped[str] = mapped_column(String(120), nullable=False)
    password_enc: Mapped[str] = mapped_column(String(512), nullable=False)  # Fernet cifrado
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    hw_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    traffic_monitoring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    speed_control: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sync_logs: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    alert_notifications: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Campos de colas y firewall MikroTik
    parent_queue: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address_list: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bandwidth_up: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    bandwidth_down: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relaciones PPPoE
    pppoe_profiles = relationship("PPPoEProfile", back_populates="gateway", cascade="all, delete-orphan")
    pppoe_secrets = relationship("PPPoESecret", back_populates="gateway", cascade="all, delete-orphan")

    # Relación con Site
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("sites.id"), nullable=True
    )
    site = relationship("Site", back_populates="gateways")

    @property
    def site_name(self) -> str | None:
        return self.site.name if self.site else None

    def __repr__(self) -> str:
        return f"<Gateway id={self.id} name={self.name} ip={self.ip}>"
