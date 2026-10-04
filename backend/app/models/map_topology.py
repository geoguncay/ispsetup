"""
Modelos SQLAlchemy de la topología del mapa de radio: puntos de acceso (AP) y enlaces.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MapAccessPoint(Base):
    __tablename__ = "map_access_points"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    # 'ap' = punto de acceso; 'station' = antena estación (extremo cliente de un PtP)
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="ap", server_default="ap")
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    frequency_mhz: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<MapAccessPoint id={self.id} name={self.name}>"


class MapLink(Base):
    """Enlace entre dos nodos del mapa (router, ap o client). `kind`: 'ptp' o 'ap'."""

    __tablename__ = "map_links"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", "target_type", "target_id", name="uq_map_link_nodes"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="ap")
    source_type: Mapped[str] = mapped_column(String(10), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(Uuid(native_uuid=False), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(10), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(Uuid(native_uuid=False), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
