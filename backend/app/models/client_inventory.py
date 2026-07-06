"""
Modelo SQLAlchemy: ClientInventoryItem — Equipos asignados a un cliente.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClientInventoryItem(Base):
    __tablename__ = "client_inventory_items"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inventory_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    mac: Mapped[str | None] = mapped_column(String(17), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relaciones
    client = relationship("Client", back_populates="inventory_items")
    inventory_item = relationship("InventoryItem", back_populates="client_assignments")

    def __repr__(self) -> str:
        return f"<ClientInventoryItem client={self.client_id} item={self.inventory_item_id}>"
