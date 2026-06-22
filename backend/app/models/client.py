"""
Modelo SQLAlchemy: Client
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    cedula: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    telefono: Mapped[str] = mapped_column(String(40), nullable=False)
    direccion: Mapped[str] = mapped_column(String(255), nullable=False)
    latitud: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitud: Mapped[float | None] = mapped_column(Float, nullable=True)
    router_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("routers.id"), nullable=False
    )
    tipo: Mapped[str] = mapped_column(String(20), nullable=False, default="static")  # "static" o "pppoe"
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relaciones
    router = relationship("Router")
    client_plans = relationship("ClientPlan", back_populates="client", cascade="all, delete-orphan")
    static_ip = relationship("StaticIP", back_populates="client", uselist=False, cascade="all, delete-orphan")
    pppoe_secret = relationship("PPPoESecret", back_populates="client", uselist=False, cascade="all, delete-orphan")
    payments = relationship("ClientPayment", back_populates="client", cascade="all, delete-orphan")
    tickets = relationship("ClientTicket", back_populates="client", cascade="all, delete-orphan")

    @property
    def site_id(self) -> uuid.UUID | None:
        return self.router.site_id if self.router else None

    @property
    def site_nombre(self) -> str | None:
        return self.router.site.nombre if (self.router and self.router.site) else None

    def __repr__(self) -> str:
        return f"<Client id={self.id} nombre={self.nombre} cedula={self.cedula}>"
