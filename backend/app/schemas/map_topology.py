"""
Esquemas Pydantic v2 para la topología del mapa (APs y enlaces).
"""
import uuid
from typing import Literal

from pydantic import BaseModel, Field

NodeType = Literal["router", "ap", "client"]
LinkKind = Literal["ptp", "ap"]


ApRole = Literal["ap", "station"]


class NodeRef(BaseModel):
    type: NodeType
    id: uuid.UUID


class AccessPointCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    ip: str | None = Field(default=None, max_length=45)
    frequency_mhz: int | None = Field(default=None, ge=1, le=100000)
    # Nodo del que cuelga este AP (router, AP o estación); crea el enlace automáticamente.
    connect_to: NodeRef | None = None


class AccessPointUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    ip: str | None = Field(default=None, max_length=45)
    frequency_mhz: int | None = Field(default=None, ge=1, le=100000)


class AccessPointRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    latitude: float
    longitude: float
    role: ApRole = "ap"
    ip: str | None = None
    frequency_mhz: int | None = None


class PtpEnd(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    ip: str | None = Field(default=None, max_length=45)


class PtpCreate(BaseModel):
    """Enlace PtP: un AP y una antena estación, con su frecuencia."""

    ap: PtpEnd
    station: PtpEnd
    frequency_mhz: int | None = Field(default=None, ge=1, le=100000)
    connect_to: NodeRef | None = None


class PtpRead(BaseModel):
    ap: AccessPointRead
    station: AccessPointRead
    link: "LinkRead"


class LinkCreate(BaseModel):
    kind: LinkKind
    source_type: NodeType
    source_id: uuid.UUID
    target_type: NodeType
    target_id: uuid.UUID


class LinkUpdate(BaseModel):
    """Cambia el tipo y/o reconecta un extremo (tipo + id van juntos)."""

    kind: LinkKind | None = None
    source_type: NodeType | None = None
    source_id: uuid.UUID | None = None
    target_type: NodeType | None = None
    target_id: uuid.UUID | None = None


class LinkRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    kind: LinkKind
    source_type: NodeType
    source_id: uuid.UUID
    target_type: NodeType
    target_id: uuid.UUID


PtpRead.model_rebuild()
