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
    latitud: float | None = None
    longitud: float | None = None
    activo: bool = True
    monitoreo_trafico: bool = True
    control_velocidad: bool = True
    sincronizar_logs: bool = True
    notificaciones_alertas: bool = True
    
    # Nuevos campos de configuración de MikroTik y ancho de banda
    cola_padre: str | None = Field(default=None, max_length=100)
    address_list: str | None = Field(default=None, max_length=100)
    ancho_banda_up: int | None = Field(default=0, ge=0)
    ancho_banda_down: int | None = Field(default=0, ge=0)
    
    # Campos de Sitios
    site_id: uuid.UUID | None = None
    new_site_nombre: str | None = Field(default=None, max_length=120)



class RouterUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    ip: str | None = Field(default=None, min_length=7, max_length=45)
    puerto_api: int | None = Field(default=None, ge=1, le=65535)
    usuario_api: str | None = Field(default=None, min_length=1, max_length=120)
    password_api: str | None = Field(default=None, min_length=1, max_length=255)
    modelo_hw: str | None = None
    notas: str | None = None
    latitud: float | None = None
    longitud: float | None = None
    activo: bool | None = None
    monitoreo_trafico: bool | None = None
    control_velocidad: bool | None = None
    sincronizar_logs: bool | None = None
    notificaciones_alertas: bool | None = None

    # Nuevos campos de configuración de MikroTik y ancho de banda
    cola_padre: str | None = None
    address_list: str | None = None
    ancho_banda_up: int | None = None
    ancho_banda_down: int | None = None

    # Campos de Sitios
    site_id: uuid.UUID | None = None
    new_site_nombre: str | None = Field(default=None, max_length=120)



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
    latitud: float | None
    longitud: float | None
    monitoreo_trafico: bool
    control_velocidad: bool
    sincronizar_logs: bool
    notificaciones_alertas: bool
    
    # Nuevos campos de configuración de MikroTik y ancho de banda
    cola_padre: str | None
    address_list: str | None
    ancho_banda_up: int | None
    ancho_banda_down: int | None

    # Campos de Sitios
    site_id: uuid.UUID | None = None
    site_nombre: str | None = None

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

