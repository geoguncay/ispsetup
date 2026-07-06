"""
Modelo SQLAlchemy: User
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, String, Uuid, func, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    # Uuid con native_uuid=False → guarda como string en SQLite,
    # como UUID nativo en PostgreSQL. Compatible con ambos dialectos.
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        Enum("admin", "technician", "viewer", name="user_role"),
        nullable=False,
        default="viewer",
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    inactivity_timeout: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    operator_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    gateway_permissions: Mapped[str | None] = mapped_column(String(255), nullable=True)
    access_schedule: Mapped[str | None] = mapped_column(String(100), nullable=True)
    permissions: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
        return f"<User id={self.id} email={self.email} role={self.role}>"
