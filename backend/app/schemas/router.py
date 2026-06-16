"""
Schemas Pydantic v2 para routers MikroTik.
"""
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, IPvAnyAddress


class RouterCreate(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    ip: str = Field(
        min_length=7,
        max_length=45,
        description="Dirección IP o host del router (LAN, WAN, ZeroTier, VPN, Tailscale, etc.)",
    )
    puerto_api: int = Field(default=8728, ge=1, le=65535)
    usuario_api: str = Field(min_length=1, max_length=120)
    password_api: str = Field(min_length=1, max_length=255, description="Se cifra con Fernet antes de guardar")
    modelo_hw: str | None = Field(default=None, max_length=120)
    notas: str | None = None
    activo: bool = True


class RouterUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    ip: str | None = Field(default=None, min_length=7, max_length=45)
    puerto_api: int | None = Field(default=None, ge=1, le=65535)
    usuario_api: str | None = Field(default=None, min_length=1, max_length=120)
    password_api: str | None = Field(default=None, min_length=1, max_length=255)
    modelo_hw: str | None = None
    notas: str | None = None
    activo: bool | None = None


class RouterRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    nombre: str
    ip: str
    puerto_api: int
    usuario_api: str
    activo: bool
    modelo_hw: str | None
    notas: str | None
    created_at: datetime
    updated_at: datetime
    # Estado dinámico (desde Redis, no desde BD)
    status: str | None = None          # "online" | "offline" | "degraded" | "unknown"
    uptime: str | None = None
    ros_version: str | None = None


class RouterStatus(BaseModel):
    router_id: uuid.UUID
    status: str                         # "online" | "offline" | "degraded"
    ip: str
    uptime: str | None = None
    ros_version: str | None = None
    interfaces: list[dict[str, Any]] = []
    error: str | None = None
    checked_at: datetime


class RouterTestResult(BaseModel):
    success: bool
    message: str
    ros_version: str | None = None
    uptime: str | None = None
    error: str | None = None


class RouterTestPayload(BaseModel):
    ip: str
    puerto_api: int = 8728
    usuario_api: str
    password_api: str | None = None
    router_id: uuid.UUID | None = None

