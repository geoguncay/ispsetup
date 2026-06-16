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
UserRole = Literal["admin", "tecnico", "viewer"]


class UserCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    rol: UserRole = "viewer"
    activo: bool = True


class UserUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    rol: UserRole | None = None
    activo: bool | None = None


class UserRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    nombre: str
    email: EmailStr
    rol: UserRole
    activo: bool
    created_at: datetime
    updated_at: datetime


# ── Dashboard stats ───────────────────────────────────────────────────────────
class ClientStats(BaseModel):
    total: int
    conectados: int
    desconectados: int
    suspendidos: int
