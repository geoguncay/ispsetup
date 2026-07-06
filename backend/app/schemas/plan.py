"""
Schemas Pydantic v2 para Planes de ancho de banda.
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class PlanBase(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    speed_down_kbps: int = Field(ge=1, le=10000000)
    speed_up_kbps: int = Field(ge=1, le=10000000)
    price: float = Field(gt=0.0)
    speed_down_mbps: int = Field(default=0)
    speed_up_mbps: int = Field(default=0)
    description: str | None = Field(default=None, max_length=255)
    taxes: float = Field(default=0.0, ge=0.0)
    limit_at_up_kbps: int | None = Field(default=None, ge=1)
    limit_at_down_kbps: int | None = Field(default=None, ge=1)
    burst_threshold_up_kbps: int | None = Field(default=None, ge=1)
    burst_threshold_down_kbps: int | None = Field(default=None, ge=1)
    priority: int | None = Field(default=8, ge=1, le=8)
    address_list: str | None = Field(default=None, max_length=100)
    parent: str | None = Field(default=None, max_length=100)


class PlanCreate(PlanBase):
    pass


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    speed_down_kbps: int | None = Field(default=None, ge=1)
    speed_up_kbps: int | None = Field(default=None, ge=1)
    price: float | None = Field(default=None, gt=0.0)
    description: str | None = Field(default=None, max_length=255)
    taxes: float | None = Field(default=None, ge=0.0)
    limit_at_up_kbps: int | None = Field(default=None, ge=1)
    limit_at_down_kbps: int | None = Field(default=None, ge=1)
    burst_threshold_up_kbps: int | None = Field(default=None, ge=1)
    burst_threshold_down_kbps: int | None = Field(default=None, ge=1)
    priority: int | None = Field(default=None, ge=1, le=8)
    address_list: str | None = Field(default=None, max_length=100)
    parent: str | None = Field(default=None, max_length=100)


class PlanResponse(PlanBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    active_clients: int
    suspended_clients: int
    created_at: datetime
    updated_at: datetime
