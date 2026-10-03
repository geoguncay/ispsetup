"""
Modelo SQLAlchemy: LoadBalancerScriptRun — historial de scripts aplicados a un balanceador.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LoadBalancerScriptRun(Base):
    __tablename__ = "load_balancer_script_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), primary_key=True, default=uuid.uuid4
    )
    load_balancer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("load_balancers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "template" (generado por el sistema según algorithm/wan_links) o "custom" (pegado por el usuario)
    origin: Mapped[str] = mapped_column(String(20), nullable=False)
    algorithm: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    output: Mapped[str | None] = mapped_column(Text, nullable=True)

    executed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(native_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    executed_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    load_balancer = relationship("LoadBalancer", back_populates="script_runs")

    def __repr__(self) -> str:
        return f"<LoadBalancerScriptRun id={self.id} lb={self.load_balancer_id} origin={self.origin} success={self.success}>"
