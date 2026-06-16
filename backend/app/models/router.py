"""
Modelo SQLAlchemy: Router
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Router id={self.id} nombre={self.nombre} ip={self.ip}>"
