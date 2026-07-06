"""
Schemas Pydantic v2 para Clientes y asignación de Planes.
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

from app.core.validators import validate_ecuadorian_cedula
from app.schemas.plan import PlanResponse
from app.schemas.static_ip import StaticIPResponse
from app.schemas.pppoe import PPPoESecretRead
from app.schemas.custom_service import CustomServiceResponse


class ClientInventoryItemCreate(BaseModel):
    inventory_item_id: uuid.UUID
    quantity: int = Field(default=1, ge=1)
    serial_number: str | None = Field(default=None, max_length=100)
    mac: str | None = Field(default=None, min_length=17, max_length=17)
    notes: str | None = None


class ClientInventoryItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    inventory_item_id: uuid.UUID
    quantity: int
    serial_number: str | None = None
    mac: str | None = None
    notes: str | None = None
    assigned_at: datetime
    # Campos del item de inventario
    item_name: str | None = None
    item_code: str | None = None
    item_model: str | None = None
    item_category: str | None = None


class ClientBase(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    last_name: str | None = Field(default=None, max_length=60)
    first_name: str | None = Field(default=None, max_length=60)
    cedula: str = Field(min_length=10, max_length=20)
    phone: str | None = Field(default=None, max_length=40)
    address: str = Field(min_length=5, max_length=255)
    latitude: float | None = None
    longitude: float | None = None
    gateway_id: uuid.UUID
    connection_type: str = Field(default="static")  # "static" o "pppoe"
    email: str | None = Field(default=None, max_length=100)
    billing_start: datetime | None = None
    billing_period_start_day: int = Field(default=1, ge=1, le=31)
    invoice_advance_days: int = Field(default=0, ge=0)
    billing_type: str = Field(default="forward")
    auto_apply_payment: bool = Field(default=True)
    use_auto_credit: bool = Field(default=True)
    separate_proration: bool = Field(default=True)
    created_at: datetime | None = None

    @field_validator("connection_type")
    @classmethod
    def validate_connection_type(cls, v: str) -> str:
        if v not in ("static", "pppoe"):
            raise ValueError("El tipo de conexión debe ser 'static' o 'pppoe'")
        return v


class ClientCreate(ClientBase):
    plan_id: uuid.UUID | None = None
    custom_service_ids: list[uuid.UUID] | None = None
    inventory_items: list[ClientInventoryItemCreate] | None = None
    ip: str | None = Field(default=None, min_length=7, max_length=45)
    mac: str | None = Field(default=None, min_length=17, max_length=17)
    notes_ip: str | None = None
    ppp_username: str | None = Field(default=None, min_length=1, max_length=100)
    ppp_password: str | None = Field(default=None, min_length=1, max_length=255)
    profile_id: uuid.UUID | None = None

    @field_validator("cedula")
    @classmethod
    def validate_cedula_ecuatoriana(cls, v: str) -> str:
        if not validate_ecuadorian_cedula(v):
            raise ValueError("La cédula o RUC ingresado no es válido")
        return v


class ClientUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    last_name: str | None = Field(default=None, max_length=60)
    first_name: str | None = Field(default=None, max_length=60)
    custom_service_ids: list[uuid.UUID] | None = None
    inventory_items: list[ClientInventoryItemCreate] | None = None
    cedula: str | None = Field(default=None, min_length=10, max_length=20)
    phone: str | None = Field(default=None, min_length=5, max_length=40)
    address: str | None = Field(default=None, min_length=5, max_length=255)
    latitude: float | None = None
    longitude: float | None = None
    gateway_id: uuid.UUID | None = None
    connection_type: str | None = None
    active: bool | None = None
    email: str | None = Field(default=None, max_length=100)
    billing_start: datetime | None = None
    billing_period_start_day: int | None = Field(default=None, ge=1, le=31)
    invoice_advance_days: int | None = Field(default=None, ge=0)
    billing_type: str | None = None
    auto_apply_payment: bool | None = None
    use_auto_credit: bool | None = None
    separate_proration: bool | None = None
    ip: str | None = Field(default=None, min_length=7, max_length=45)
    mac: str | None = Field(default=None, min_length=17, max_length=17)
    notes_ip: str | None = None
    ppp_username: str | None = Field(default=None, min_length=1, max_length=100)
    ppp_password: str | None = Field(default=None, min_length=1, max_length=255)
    profile_id: uuid.UUID | None = None
    created_at: datetime | None = None

    @field_validator("connection_type")
    @classmethod
    def validate_connection_type(cls, v: str | None) -> str | None:
        if v is not None and v not in ("static", "pppoe"):
            raise ValueError("El tipo de conexión debe ser 'static' o 'pppoe'")
        return v

    @field_validator("cedula")
    @classmethod
    def validate_cedula_ecuatoriana(cls, v: str | None) -> str | None:
        if v is not None and not validate_ecuadorian_cedula(v):
            raise ValueError("La cédula o RUC ingresado no es válido")
        return v


# Schema para ClientPlan
class ClientPlanResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    cliente_id: uuid.UUID
    plan_id: uuid.UUID
    fecha_inicio: datetime
    fecha_fin: datetime | None = None
    estado: str
    created_at: datetime
    updated_at: datetime
    plan: PlanResponse | None = None


class SuspensionLogResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    client_id: uuid.UUID
    reason: str
    suspended_at: datetime
    reactivated_at: datetime | None = None
    user_id: uuid.UUID | None = None
    user_name: str | None = None


# Schema de respuesta de Cliente
class ClientResponse(ClientBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    active: bool
    created_at: datetime
    updated_at: datetime

    # Campos enriquecidos
    plan_activo: PlanResponse | None = None
    gateway_name: str | None = None
    static_ip: StaticIPResponse | None = None
    pppoe_secret: PPPoESecretRead | None = None
    site_id: uuid.UUID | None = None
    site_name: str | None = None
    custom_services: list[CustomServiceResponse] = []
    inventory_items: list[ClientInventoryItemResponse] = []
    scheduled_suspension: datetime | None = None
    scheduled_suspension_reason: str | None = None
    scheduled_reactivation: datetime | None = None


# Schema de respuesta de listado de clientes con paginación
class ClientListResponse(BaseModel):
    items: list[ClientResponse]
    total: int
