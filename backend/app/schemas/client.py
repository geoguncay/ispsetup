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


class ClientBase(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    cedula: str = Field(min_length=10, max_length=20)
    telefono: str = Field(min_length=5, max_length=40)
    direccion: str = Field(min_length=5, max_length=255)
    latitud: float | None = None
    longitud: float | None = None
    router_id: uuid.UUID
    tipo: str = Field(default="static")  # "static" o "pppoe"
    email: str | None = Field(default=None, max_length=100)
    created_at: datetime | None = None

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, v: str) -> str:
        if v not in ("static", "pppoe"):
            raise ValueError("El tipo de conexión debe ser 'static' o 'pppoe'")
        return v


class ClientCreate(ClientBase):
    plan_id: uuid.UUID | None = None
    ip: str | None = Field(default=None, min_length=7, max_length=45)
    mac: str | None = Field(default=None, min_length=17, max_length=17)
    notas_ip: str | None = None
    usuario_ppp: str | None = Field(default=None, min_length=1, max_length=100)
    contraseña_ppp: str | None = Field(default=None, min_length=1, max_length=255)
    perfil_id: uuid.UUID | None = None

    @field_validator("cedula")
    @classmethod
    def validate_cedula_ecuatoriana(cls, v: str) -> str:
        if not validate_ecuadorian_cedula(v):
            raise ValueError("La cédula o RUC ingresado no es válido")
        return v


class ClientUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    cedula: str | None = Field(default=None, min_length=10, max_length=20)
    telefono: str | None = Field(default=None, min_length=5, max_length=40)
    direccion: str | None = Field(default=None, min_length=5, max_length=255)
    latitud: float | None = None
    longitud: float | None = None
    router_id: uuid.UUID | None = None
    tipo: str | None = None
    activo: bool | None = None
    email: str | None = Field(default=None, max_length=100)
    ip: str | None = Field(default=None, min_length=7, max_length=45)
    mac: str | None = Field(default=None, min_length=17, max_length=17)
    notas_ip: str | None = None
    usuario_ppp: str | None = Field(default=None, min_length=1, max_length=100)
    contraseña_ppp: str | None = Field(default=None, min_length=1, max_length=255)
    perfil_id: uuid.UUID | None = None
    created_at: datetime | None = None

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, v: str | None) -> str | None:
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
    cliente_id: uuid.UUID
    motivo: str
    fecha_suspension: datetime
    fecha_reactivacion: datetime | None = None
    usuario_id: uuid.UUID | None = None
    usuario_nombre: str | None = None


# Schema de respuesta de Cliente
class ClientResponse(ClientBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    activo: bool
    created_at: datetime
    updated_at: datetime
    
    # Campos enriquecidos
    plan_activo: PlanResponse | None = None
    router_nombre: str | None = None
    static_ip: StaticIPResponse | None = None
    pppoe_secret: PPPoESecretRead | None = None
    site_id: uuid.UUID | None = None
    site_nombre: str | None = None


# Schema de respuesta de listado de clientes con paginación
class ClientListResponse(BaseModel):
    items: list[ClientResponse]
    total: int
