"""
Modelo SQLAlchemy: SuspensionLog
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SuspensionLog(Base):
    __tablename__ = "suspension_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    suspended_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    reactivated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relaciones
    client = relationship("Client")
    user = relationship("User")

    @property
    def user_name(self) -> str | None:
        return self.user.name if self.user else None

    def __repr__(self) -> str:
        return f"<SuspensionLog id={self.id} client_id={self.client_id} reason={self.reason}>"
