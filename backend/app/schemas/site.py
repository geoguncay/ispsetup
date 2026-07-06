"""
Esquemas Pydantic v2 para Sitios (Sites).
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class SiteCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    latitude: float | None = None
    longitude: float | None = None


class SiteUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    latitude: float | None = None
    longitude: float | None = None


class SiteRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    latitude: float | None = None
    longitude: float | None = None
    created_at: datetime
    updated_at: datetime
