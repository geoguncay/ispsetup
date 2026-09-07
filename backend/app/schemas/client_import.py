"""
Schemas Pydantic para la importación masiva de clientes desde CSV.
"""
from pydantic import BaseModel, Field
from app.schemas.client import ClientCreate

class CSVRowValidation(BaseModel):
    index: int
    data: dict = Field(default_factory=dict)
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

class ImportValidationResponse(BaseModel):
    rows: list[CSVRowValidation]
    total_rows: int
    valid_rows: int
    invalid_rows: int
    detected_routers: list[str] = Field(default_factory=list)
    detected_plans: list[str] = Field(default_factory=list)

class BulkImportPayload(BaseModel):
    clients: list[ClientCreate]
