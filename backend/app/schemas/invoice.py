"""
Schemas Pydantic v2 para Invoice (Facturas)
"""
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, model_validator


class InvoiceBase(BaseModel):
    client_id: uuid.UUID
    plan_id: uuid.UUID | None = None
    period: str = Field(min_length=7, max_length=10)  # "MM/AAAA"
    amount: float
    due_date: datetime
    concept: str | None = Field(default=None, max_length=255)


class InvoiceCreate(InvoiceBase):
    pass


class InvoiceUpdate(BaseModel):
    status: str = Field(pattern="^(pending|paid|overdue|cancelled)$")


class InvoiceEdit(BaseModel):
    """Edición de una factura pendiente/vencida (sin pagos aún). Todos los campos son opcionales."""
    amount: float | None = Field(default=None, gt=0.0)
    period: str | None = Field(default=None, min_length=7, max_length=10)  # "MM/AAAA"
    due_date: datetime | None = None
    concept: str | None = Field(default=None, max_length=255)


class InvoiceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    client_id: uuid.UUID
    plan_id: uuid.UUID | None
    period: str
    amount: float
    issue_date: datetime
    due_date: datetime
    status: str
    created_at: datetime
    concept: str | None = None
    client_name: str | None = None
    client_cedula: str | None = None
    plan_name: str | None = None
    payment_id: uuid.UUID | None = None

    @model_validator(mode="before")
    @classmethod
    def resolve_orm_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict) and hasattr(data, "client_id"):
            client = getattr(data, "client", None)
            plan = getattr(data, "plan", None)
            payments = getattr(data, "payments", [])
            completed_payments = [p for p in payments if p.status == "completed"]
            payment_id = completed_payments[0].id if completed_payments else None

            return {
                "id": getattr(data, "id", None),
                "client_id": getattr(data, "client_id", None),
                "plan_id": getattr(data, "plan_id", None),
                "period": getattr(data, "period", None),
                "amount": float(getattr(data, "amount", 0.0)),
                "issue_date": getattr(data, "issue_date", None),
                "due_date": getattr(data, "due_date", None),
                "status": getattr(data, "status", None),
                "created_at": getattr(data, "created_at", None),
                "concept": getattr(data, "concept", None),
                "client_name": client.full_name if client else None,
                "client_cedula": client.cedula if client else None,
                "plan_name": plan.name if plan else None,
                "payment_id": payment_id
            }
        return data
