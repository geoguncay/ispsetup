"""
Schemas Pydantic v2 para Servicios Personalizados.
"""
from datetime import datetime
import uuid
from pydantic import BaseModel, Field


class CustomServiceBase(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    precio: float = Field(gt=0.0)
    descripcion: str | None = Field(default=None, max_length=255)
    impuestos: float = Field(default=0.0, ge=0.0)
    recurrente: bool = Field(default=True)
    activo: bool = Field(default=True)


class CustomServiceCreate(CustomServiceBase):
    pass


class CustomServiceUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    precio: float | None = Field(default=None, gt=0.0)
    descripcion: str | None = Field(default=None, max_length=255)
    impuestos: float | None = Field(default=None, ge=0.0)
    activo: bool | None = Field(default=None)


class CustomServiceResponse(CustomServiceBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
