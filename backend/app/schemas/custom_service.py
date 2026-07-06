"""
Schemas Pydantic v2 para Servicios Personalizados.
"""
from datetime import datetime
import uuid
from pydantic import BaseModel, Field


class CustomServiceBase(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    price: float = Field(gt=0.0)
    description: str | None = Field(default=None, max_length=255)
    taxes: float = Field(default=0.0, ge=0.0)
    recurring: bool = Field(default=True)
    active: bool = Field(default=True)


class CustomServiceCreate(CustomServiceBase):
    pass


class CustomServiceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    price: float | None = Field(default=None, gt=0.0)
    description: str | None = Field(default=None, max_length=255)
    taxes: float | None = Field(default=None, ge=0.0)
    active: bool | None = Field(default=None)


class CustomServiceResponse(CustomServiceBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
