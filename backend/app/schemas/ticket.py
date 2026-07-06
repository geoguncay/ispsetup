import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class TicketCreate(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=5)
    priority: str = Field(default="medium")  # "low", "medium", "high"


class TicketResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    client_id: uuid.UUID
    title: str
    description: str
    priority: str
    status: str
    created_at: datetime
    updated_at: datetime
