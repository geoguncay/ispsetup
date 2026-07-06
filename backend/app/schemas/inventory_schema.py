"""
Esquemas Pydantic para Inventario (InventoryItem)
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from app.schemas.supplier_schema import SupplierResponse

class InventoryItemBase(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=1, max_length=50)
    quantity: int = Field(default=0, ge=0)
    min_alert: int = Field(default=5, ge=0)
    purchase_price: float = Field(default=0.0, ge=0.0)
    sale_price: float = Field(default=0.0, ge=0.0)
    description: str | None = None
    category: str | None = Field(default=None, max_length=50)
    model: str | None = Field(default=None, max_length=80)
    supplier_id: uuid.UUID | None = None

class InventoryItemCreate(InventoryItemBase):
    pass

class InventoryItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    quantity: int | None = Field(default=None, ge=0)
    min_alert: int | None = Field(default=None, ge=0)
    purchase_price: float | None = Field(default=None, ge=0.0)
    sale_price: float | None = Field(default=None, ge=0.0)
    description: str | None = None
    category: str | None = Field(default=None, max_length=50)
    model: str | None = Field(default=None, max_length=80)
    supplier_id: uuid.UUID | None = None

class InventoryItemResponse(InventoryItemBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    supplier: SupplierResponse | None = None
