"""
Esquemas Pydantic para Proveedores (Suppliers)
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, EmailStr

class SupplierBase(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    ruc: str = Field(min_length=10, max_length=20)
    phone: str = Field(min_length=5, max_length=40)
    email: EmailStr | None = None
    address: str = Field(min_length=5, max_length=255)
    notes: str | None = None

class SupplierCreate(SupplierBase):
    pass

class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    ruc: str | None = Field(default=None, min_length=10, max_length=20)
    phone: str | None = Field(default=None, min_length=5, max_length=40)
    email: EmailStr | None = None
    address: str | None = Field(default=None, min_length=5, max_length=255)
    notes: str | None = None

class SupplierResponse(SupplierBase):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
