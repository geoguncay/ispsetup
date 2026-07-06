"""
Modelo SQLAlchemy: CustomService
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, Uuid, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CustomService(Base):
    __tablename__ = "custom_services"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    taxes: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.0)
    recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
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
        return f"<CustomService id={self.id} name={self.name} price={self.price}>"
