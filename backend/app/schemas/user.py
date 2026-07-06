"""
Schemas Pydantic v2 para usuarios y autenticación.
"""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


# ── Auth ──────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


# ── User ──────────────────────────────────────────────────────────────────────
UserRole = Literal["admin", "technician", "viewer"]


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = "viewer"
    active: bool = True
    inactivity_timeout: int = 0
    operator_type: str | None = None
    gateway_permissions: str | None = None
    access_schedule: str | None = None
    permissions: str | None = None


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    role: UserRole | None = None
    active: bool | None = None
    inactivity_timeout: int | None = None
    operator_type: str | None = None
    gateway_permissions: str | None = None
    access_schedule: str | None = None
    permissions: str | None = None


class UserRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    email: EmailStr
    role: UserRole
    active: bool
    inactivity_timeout: int
    avatar_url: str | None = None
    operator_type: str | None
    gateway_permissions: str | None
    access_schedule: str | None
    permissions: str | None
    created_at: datetime
    updated_at: datetime


# ── Dashboard stats ───────────────────────────────────────────────────────────
class ClientStats(BaseModel):
    total: int
    connected: int
    disconnected: int
    suspended: int
