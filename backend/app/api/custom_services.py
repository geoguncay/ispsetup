"""
Endpoints CRUD de Servicios Personalizados.
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminOnly, CurrentUser, DBSession
from app.models.custom_service import CustomService
from app.schemas.custom_service import CustomServiceCreate, CustomServiceResponse, CustomServiceUpdate

router = APIRouter(prefix="/custom-services", tags=["custom-services"])


@router.get("", response_model=list[CustomServiceResponse])
def list_custom_services(db: DBSession, _: CurrentUser) -> list[CustomService]:
    """Lista todos los servicios personalizados."""
    return db.query(CustomService).order_by(CustomService.precio.asc()).all()


@router.post("", response_model=CustomServiceResponse, status_code=status.HTTP_201_CREATED)
def create_custom_service(payload: CustomServiceCreate, db: DBSession, _: AdminOnly) -> CustomService:
    """Crea un nuevo servicio personalizado (Solo Administradores)."""
    cs = CustomService(
        nombre=payload.nombre,
        precio=payload.precio,
        descripcion=payload.descripcion,
        impuestos=payload.impuestos,
        recurrente=payload.recurrente,
        activo=payload.activo,
    )
    db.add(cs)
    try:
        db.commit()
        db.refresh(cs)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un servicio con el nombre: {payload.nombre}",
        )
    return cs


@router.get("/{service_id}", response_model=CustomServiceResponse)
def get_custom_service(service_id: uuid.UUID, db: DBSession, _: CurrentUser) -> CustomService:
    """Obtiene el detalle de un servicio personalizado."""
    cs = db.get(CustomService, service_id)
    if not cs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Servicio no encontrado")
    return cs


@router.put("/{service_id}", response_model=CustomServiceResponse)
def update_custom_service(
    service_id: uuid.UUID, payload: CustomServiceUpdate, db: DBSession, _: AdminOnly
) -> CustomService:
    """Edita un servicio personalizado existente (Solo Administradores)."""
    cs = db.get(CustomService, service_id)
    if not cs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Servicio no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(cs, field, value)

    try:
        db.commit()
        db.refresh(cs)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un servicio con el nombre: {payload.nombre}",
        )

    return cs


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_custom_service(service_id: uuid.UUID, db: DBSession, _: AdminOnly) -> None:
    """Elimina un servicio personalizado (Solo Administradores)."""
    cs = db.get(CustomService, service_id)
    if not cs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Servicio no encontrado")

    db.delete(cs)
    db.commit()
