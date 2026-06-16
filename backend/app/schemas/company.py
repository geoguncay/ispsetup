"""
Schemas Pydantic v2 para la información de la empresa.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class CompanyBase(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    ruc: str | None = Field(default=None, max_length=20)
    direccion: str | None = Field(default=None, max_length=255)
    telefono: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = Field(default=None)
    sitio_web: str | None = Field(default=None, max_length=255)


class CompanyUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    ruc: str | None = Field(default=None, max_length=20)
    direccion: str | None = Field(default=None, max_length=255)
    telefono: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = Field(default=None)
    sitio_web: str | None = Field(default=None, max_length=255)


class CompanyRead(CompanyBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
