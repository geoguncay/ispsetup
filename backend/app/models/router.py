"""
Modelo SQLAlchemy: Router
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Router(Base):
    __tablename__ = "routers"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    # Nota: Almacena cualquier dirección IP o host de red (LAN, WAN, VPN, Tailscale, ZeroTier, etc.).
    ip: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    puerto_api: Mapped[int] = mapped_column(Integer, nullable=False, default=8728)
    usuario_api: Mapped[str] = mapped_column(String(120), nullable=False)
    password_enc: Mapped[str] = mapped_column(String(512), nullable=False)  # Fernet cifrado
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    modelo_hw: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notas: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitud: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitud: Mapped[float | None] = mapped_column(Float, nullable=True)
    monitoreo_trafico: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    control_velocidad: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sincronizar_logs: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notificaciones_alertas: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    
    # Nuevos campos de colas y firewall MikroTik
    cola_padre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address_list: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ancho_banda_up: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    ancho_banda_down: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)

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
    pppoe_profiles = relationship("PPPoEProfile", back_populates="router", cascade="all, delete-orphan")
    pppoe_secrets = relationship("PPPoESecret", back_populates="router", cascade="all, delete-orphan")

    # Relación con Site
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("sites.id"), nullable=True
    )
    site = relationship("Site", back_populates="routers")

    @property
    def site_nombre(self) -> str | None:
        return self.site.nombre if self.site else None

    def __repr__(self) -> str:
        return f"<Router id={self.id} nombre={self.nombre} ip={self.ip}>"
