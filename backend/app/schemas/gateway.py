"""
Schemas Pydantic v2 para gateways MikroTik.
"""
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SecurityMode = Literal['none_api', 'ppp_api', 'hotspot_api', 'ppp_radius', 'hotspot_radius']
TrafficAccounting = Literal['traffic_flow', 'accounting_v6']
SpeedControlType = Literal['pcq_addresslist', 'simple_queues', 'dhcp_lease_dynamic', 'none']


class GatewayCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    ip: str = Field(
        min_length=7,
        max_length=45,
        description="Dirección IP o host del router (LAN, WAN, ZeroTier, VPN, Tailscale, etc.)",
    )
    api_port: int = Field(default=8728, ge=1, le=65535)
    api_username: str = Field(min_length=1, max_length=120)
    password_api: str = Field(min_length=1, max_length=255, description="Se cifra con Fernet antes de guardar")
    hw_model: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    active: bool = True
    traffic_monitoring: bool = True
    speed_control: bool = True
    sync_logs: bool = True
    alert_notifications: bool = True
    security_mode: SecurityMode = 'none_api'
    traffic_accounting: TrafficAccounting = 'traffic_flow'
    speed_control_type: SpeedControlType = 'simple_queues'

    # Nuevos campos de configuración de MikroTik y ancho de banda
    parent_queue: str | None = Field(default=None, max_length=100)
    address_list: str | None = Field(default=None, max_length=100)
    suspend_list: str | None = Field(default=None, max_length=100)
    config_mode: Literal['system', 'gateway'] = 'system'
    bandwidth_up: int | None = Field(default=0, ge=0)
    bandwidth_down: int | None = Field(default=0, ge=0)

    # Campos de Sitios
    site_id: uuid.UUID | None = None
    new_site_name: str | None = Field(default=None, max_length=120)



class GatewayUpdate(BaseModel):
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
    traffic_monitoring: bool | None = None
    speed_control: bool | None = None
    sync_logs: bool | None = None
    alert_notifications: bool | None = None
    security_mode: SecurityMode | None = None
    traffic_accounting: TrafficAccounting | None = None
    speed_control_type: SpeedControlType | None = None

    # Nuevos campos de configuración de MikroTik y ancho de banda
    parent_queue: str | None = None
    address_list: str | None = None
    suspend_list: str | None = None
    config_mode: Literal['system', 'gateway'] | None = None
    bandwidth_up: int | None = None
    bandwidth_down: int | None = None

    # Campos de Sitios
    site_id: uuid.UUID | None = None
    new_site_name: str | None = Field(default=None, max_length=120)


class GatewaySettingsUpdate(BaseModel):
    security_mode: SecurityMode
    traffic_accounting: TrafficAccounting
    speed_control_type: SpeedControlType


class GatewayRead(BaseModel):
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
    traffic_monitoring: bool
    speed_control: bool
    sync_logs: bool
    alert_notifications: bool
    security_mode: SecurityMode
    traffic_accounting: TrafficAccounting
    speed_control_type: SpeedControlType
    settings_configured: bool

    # Nuevos campos de configuración de MikroTik y ancho de banda
    parent_queue: str | None
    address_list: str | None
    suspend_list: str | None
    config_mode: str
    bandwidth_up: int | None
    bandwidth_down: int | None

    # Campos de Sitios
    site_id: uuid.UUID | None = None
    site_name: str | None = None

    created_at: datetime
    updated_at: datetime

    # Estado dinámico (desde Redis, no desde BD)
    status: str | None = None          # "online" | "offline" | "degraded" | "unknown"
    uptime: str | None = None
    ros_version: str | None = None


class GatewayStatus(BaseModel):
    gateway_id: uuid.UUID
    status: str                         # "online" | "offline" | "degraded"
    ip: str
    uptime: str | None = None
    ros_version: str | None = None
    interfaces: list[dict[str, Any]] = []
    error: str | None = None
    checked_at: datetime


class GatewayTestResult(BaseModel):
    success: bool
    message: str
    ros_version: str | None = None
    uptime: str | None = None
    error: str | None = None


class GatewayTestPayload(BaseModel):
    ip: str
    api_port: int = 8728
    api_username: str
    password_api: str | None = None
    gateway_id: uuid.UUID | None = None
