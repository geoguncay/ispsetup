"""
Esquemas Pydantic para Categorías de Productos (ProductCategory)
"""
import uuid
from pydantic import BaseModel, Field


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class ProductCategoryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class ProductCategoryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
