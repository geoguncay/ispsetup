"""
Schemas Pydantic v2 para ClientPayment (Pagos)
"""
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, model_validator


class PaymentCreate(BaseModel):
    invoice_id: uuid.UUID
    monto: float = Field(gt=0)
    metodo: str = Field(pattern="^(efectivo|transferencia|tarjeta|deposito)$")
    notas: str | None = Field(default=None, max_length=255)


class PaymentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    cliente_id: uuid.UUID
    invoice_id: uuid.UUID | None
    usuario_id: uuid.UUID | None
    monto: float
    fecha_pago: datetime
    metodo: str
    estado: str
    notas: str | None
    created_at: datetime
    cliente_nombre: str | None = None
    usuario_nombre: str | None = None

    @model_validator(mode="before")
    @classmethod
    def resolve_orm_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict) and hasattr(data, "cliente_id"):
            client = getattr(data, "client", None)
            user = getattr(data, "usuario", None)
            
            return {
                "id": getattr(data, "id", None),
                "cliente_id": getattr(data, "cliente_id", None),
                "invoice_id": getattr(data, "invoice_id", None),
                "usuario_id": getattr(data, "usuario_id", None),
                "monto": float(getattr(data, "monto", 0.0)),
                "fecha_pago": getattr(data, "fecha_pago", None),
                "metodo": getattr(data, "metodo", None),
                "estado": getattr(data, "estado", None),
                "notas": getattr(data, "notas", None),
                "created_at": getattr(data, "created_at", None),
                "cliente_nombre": client.nombre if client else None,
                "usuario_nombre": user.nombre if user else None
            }
        return data
