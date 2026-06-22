"""
Esquemas Pydantic v2 para Sitios (Sites).
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class SiteCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)


class SiteRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    nombre: str
    created_at: datetime
    updated_at: datetime
