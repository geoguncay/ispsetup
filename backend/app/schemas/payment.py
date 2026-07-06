"""
Schemas Pydantic v2 para ClientPayment (Pagos)
"""
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field, model_validator


class PaymentCreate(BaseModel):
    invoice_id: uuid.UUID
    amount: float = Field(gt=0)
    method: str = Field(min_length=1, max_length=50)
    notes: str | None = Field(default=None, max_length=255)


class PaymentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    client_id: uuid.UUID
    invoice_id: uuid.UUID | None
    user_id: uuid.UUID | None
    amount: float
    payment_date: datetime
    method: str
    status: str
    notes: str | None
    created_at: datetime
    client_name: str | None = None
    user_name: str | None = None

    @model_validator(mode="before")
    @classmethod
    def resolve_orm_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict) and hasattr(data, "client_id"):
            client = getattr(data, "client", None)
            user = getattr(data, "user", None)

            return {
                "id": getattr(data, "id", None),
                "client_id": getattr(data, "client_id", None),
                "invoice_id": getattr(data, "invoice_id", None),
                "user_id": getattr(data, "user_id", None),
                "amount": float(getattr(data, "amount", 0.0)),
                "payment_date": getattr(data, "payment_date", None),
                "method": getattr(data, "method", None),
                "status": getattr(data, "status", None),
                "notes": getattr(data, "notes", None),
                "created_at": getattr(data, "created_at", None),
                "client_name": client.name if client else None,
                "user_name": user.name if user else None
            }
        return data
