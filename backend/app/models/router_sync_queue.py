import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy import JSON, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class RouterSyncQueue(Base):
    __tablename__ = "router_sync_queue"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    router_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False),
        ForeignKey("routers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(native_uuid=False),
        ForeignKey("clients.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Operación: add_to_address_list | add_queue | add_pppoe_profile | add_pppoe_secret
    operation: Mapped[str] = mapped_column(String(50), nullable=False)
    # Parámetros serializados para la función de sync
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # pending | failed | done
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    next_retry_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    router = relationship("Router")
    client = relationship("Client")

    def __repr__(self) -> str:
        return f"<RouterSyncQueue id={self.id} op={self.operation} status={self.status}>"
