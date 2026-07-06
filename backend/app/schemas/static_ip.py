"""
Schemas Pydantic v2 para Direcciones IP Estáticas.
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class StaticIPBase(BaseModel):
    ip: str = Field(min_length=7, max_length=45, description="Dirección IP del cliente")
    mac: str | None = Field(default=None, min_length=17, max_length=17, description="Dirección MAC física")
    notes: str | None = None


class StaticIPCreate(StaticIPBase):
    gateway_id: uuid.UUID


class StaticIPUpdate(BaseModel):
    ip: str | None = Field(default=None, min_length=7, max_length=45)
    mac: str | None = Field(default=None, min_length=17, max_length=17)
    notes: str | None = None
    gateway_id: uuid.UUID | None = None


class StaticIPResponse(StaticIPBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    client_id: uuid.UUID
    gateway_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
