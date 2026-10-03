"""
Modelo SQLAlchemy: LoadBalancer (balanceador de carga MikroTik — RB o CCR)
"""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LoadBalancer(Base):
    __tablename__ = "load_balancers"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Nota: igual que Router, almacena cualquier dirección IP o host alcanzable
    # (LAN, WAN, VPN, ZeroTier, etc.).
    ip: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    api_port: Mapped[int] = mapped_column(Integer, nullable=False, default=8728)
    api_username: Mapped[str] = mapped_column(String(120), nullable=False)
    password_enc: Mapped[str] = mapped_column(String(512), nullable=False)  # Fernet cifrado
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    hw_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relación con Site
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("sites.id"), nullable=True
    )
    site = relationship("Site", back_populates="load_balancers")

    # Nodo ZeroTier vinculado (autoriza/consulta estado vía ZeroTier Central).
    zerotier_node_id: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Configuración de balanceo de carga ("pcc" | "failover").
    algorithm: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pcc", server_default="pcc"
    )
    # Lista de enlaces WAN: [{"interface": str, "gateway": str, "weight": int, "priority": int}, ...]
    wan_links: Mapped[list | None] = mapped_column(
        JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql"), nullable=True
    )

    # Último script aplicado (por plantilla o personalizado) — ver LoadBalancerScriptRun para el historial.
    last_script_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_script_applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_script_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

    script_runs = relationship(
        "LoadBalancerScriptRun", back_populates="load_balancer", cascade="all, delete-orphan"
    )

    @property
    def site_name(self) -> str | None:
        return self.site.name if self.site else None

    def __repr__(self) -> str:
        return f"<LoadBalancer id={self.id} name={self.name} ip={self.ip}>"
