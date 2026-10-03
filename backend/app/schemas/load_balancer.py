"""
Schemas Pydantic v2 para balanceadores de carga.
"""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

BalancingAlgorithm = Literal['pcc', 'failover']


class WanLink(BaseModel):
    interface: str = Field(min_length=1, max_length=64)
    gateway: str = Field(min_length=7, max_length=45)
    # PCC: proporción relativa de tráfico para este enlace frente a los demás.
    weight: int = Field(default=1, ge=1, le=100)
    # Failover: orden de preferencia (0 = principal, 1 = primer respaldo, ...).
    priority: int = Field(default=0, ge=0, le=100)


class LoadBalancerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    ip: str = Field(
        min_length=7,
        max_length=45,
        description="Dirección IP o host del balanceador (LAN, WAN, ZeroTier, VPN, etc.)",
    )
    api_port: int = Field(default=8728, ge=1, le=65535)
    api_username: str = Field(min_length=1, max_length=120)
    password_api: str = Field(min_length=1, max_length=255, description="Se cifra con Fernet antes de guardar")
    hw_model: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    active: bool = True

    # Campos de Sitios
    site_id: uuid.UUID | None = None
    new_site_name: str | None = Field(default=None, max_length=120)

    # Nodo ZeroTier vinculado (opcional)
    zerotier_node_id: str | None = Field(default=None, max_length=20)


class LoadBalancerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    ip: str | None = Field(default=None, min_length=7, max_length=45)
    api_port: int | None = Field(default=None, ge=1, le=65535)
    api_username: str | None = Field(default=None, min_length=1, max_length=120)
    password_api: str | None = Field(default=None, min_length=1, max_length=255)
    hw_model: str | None = None
    notes: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    active: bool | None = None

    # Campos de Sitios
    site_id: uuid.UUID | None = None
    new_site_name: str | None = Field(default=None, max_length=120)

    # Nodo ZeroTier vinculado (opcional)
    zerotier_node_id: str | None = Field(default=None, max_length=20)


class LoadBalancerRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    ip: str
    api_port: int
    api_username: str
    active: bool
    hw_model: str | None
    notes: str | None
    latitude: float | None
    longitude: float | None

    site_id: uuid.UUID | None = None
    site_name: str | None = None

    # Nodo ZeroTier vinculado (opcional)
    zerotier_node_id: str | None = None

    # Configuración de balanceo
    algorithm: BalancingAlgorithm = 'pcc'
    wan_links: list[WanLink] | None = None
    last_script_source: str | None = None
    last_script_applied_at: datetime | None = None
    last_script_status: str | None = None

    created_at: datetime
    updated_at: datetime

    # Estado dinámico (desde Redis, no desde BD) — ver services/load_balancer/health.py
    status: str | None = None  # "online" | "offline" | "tunnel_down" | "unknown"
    uptime: str | None = None
    ros_version: str | None = None
    zerotier_online: bool | None = None


class LoadBalancerStatus(BaseModel):
    load_balancer_id: uuid.UUID
    # "online"      → RouterOS API responde
    # "offline"     → RouterOS API no responde (y el túnel ZeroTier está OK, o no hay túnel que consultar)
    # "tunnel_down" → RouterOS API no responde Y el nodo ZeroTier no reporta a ZeroTier Central
    status: str
    ip: str
    uptime: str | None = None
    ros_version: str | None = None
    error: str | None = None
    checked_at: datetime
    zerotier_checked: bool = False
    zerotier_online: bool | None = None


class LoadBalancerBalancingUpdate(BaseModel):
    algorithm: BalancingAlgorithm
    # Se permite guardar menos de 2 enlaces (la UI los agrega de a uno con un modal);
    # el mínimo de 2 para poder balancear se exige recién al aplicar la plantilla
    # (ver POST .../apply-template).
    wan_links: list[WanLink] = Field(default_factory=list, max_length=8)


class LoadBalancerScriptApplyResult(BaseModel):
    success: bool
    message: str
    source: str
    output: str | None = None


class LoadBalancerInterfaceRead(BaseModel):
    name: str
    running: bool
    disabled: bool
    rx_bytes: int
    tx_bytes: int
    rx_rate: int  # bps
    tx_rate: int  # bps


class LoadBalancerScriptRunRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    load_balancer_id: uuid.UUID
    origin: Literal['template', 'custom']
    algorithm: str | None = None
    source: str
    success: bool
    output: str | None = None
    executed_by_name: str | None = None
    created_at: datetime


class LoadBalancerTestResult(BaseModel):
    success: bool
    message: str
    ros_version: str | None = None
    uptime: str | None = None
    error: str | None = None


class LoadBalancerTestPayload(BaseModel):
    ip: str
    api_port: int = 8728
    api_username: str
    password_api: str | None = None
    load_balancer_id: uuid.UUID | None = None
