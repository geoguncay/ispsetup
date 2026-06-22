"""
Schemas Pydantic v2 para Invoice (Facturas)
"""
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, model_validator


class InvoiceBase(BaseModel):
    cliente_id: uuid.UUID
    plan_id: uuid.UUID | None = None
    periodo: str = Field(min_length=7, max_length=10)  # "MM/AAAA"
    monto: float
    fecha_vencimiento: datetime


class InvoiceCreate(InvoiceBase):
    pass


class InvoiceUpdate(BaseModel):
    estado: str = Field(pattern="^(pendiente|pagado|vencido)$")


class InvoiceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    cliente_id: uuid.UUID
    plan_id: uuid.UUID | None
    periodo: str
    monto: float
    fecha_emision: datetime
    fecha_vencimiento: datetime
    estado: str
    created_at: datetime
    cliente_nombre: str | None = None
    cliente_cedula: str | None = None
    plan_nombre: str | None = None
    pago_id: uuid.UUID | None = None

    @model_validator(mode="before")
    @classmethod
    def resolve_orm_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict) and hasattr(data, "cliente_id"):
            client = getattr(data, "client", None)
            plan = getattr(data, "plan", None)
            payments = getattr(data, "payments", [])
            completed_payments = [p for p in payments if p.estado == "completado"]
            pago_id = completed_payments[0].id if completed_payments else None
            
            return {
                "id": getattr(data, "id", None),
                "cliente_id": getattr(data, "cliente_id", None),
                "plan_id": getattr(data, "plan_id", None),
                "periodo": getattr(data, "periodo", None),
                "monto": float(getattr(data, "monto", 0.0)),
                "fecha_emision": getattr(data, "fecha_emision", None),
                "fecha_vencimiento": getattr(data, "fecha_vencimiento", None),
                "estado": getattr(data, "estado", None),
                "created_at": getattr(data, "created_at", None),
                "cliente_nombre": client.nombre if client else None,
                "cliente_cedula": client.cedula if client else None,
                "plan_nombre": plan.nombre if plan else None,
                "pago_id": pago_id
            }
        return data
