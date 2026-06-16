"""
Endpoints de configuración de la empresa.
"""
from fastapi import APIRouter

from app.core.deps import AdminOnly, CurrentUser, DBSession
from app.models.company import Company
from app.schemas.company import CompanyRead, CompanyUpdate

router = APIRouter(prefix="/company", tags=["company"])


@router.get("", response_model=CompanyRead)
def get_company(db: DBSession, current_user: CurrentUser) -> Company:
    """
    Obtiene los datos de la empresa.
    Si no existe ningún registro, crea uno por defecto.
    Cualquier usuario autenticado puede consultarlo.
    """
    company = db.query(Company).first()
    if not company:
        company = Company(
            nombre="Mi WISP",
            ruc="",
            direccion="",
            telefono="",
            email=None,
            sitio_web="",
        )
        db.add(company)
        db.commit()
        db.refresh(company)
    return company


@router.put("", response_model=CompanyRead)
def update_company(
    payload: CompanyUpdate, db: DBSession, _: AdminOnly
) -> Company:
    """
    Actualiza los datos de la empresa. Solo permitido para administradores.
    """
    company = db.query(Company).first()
    if not company:
        company = Company(
            nombre="Mi WISP",
            ruc="",
            direccion="",
            telefono="",
            email=None,
            sitio_web="",
        )
        db.add(company)
        db.commit()
        db.refresh(company)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(company, field, value)

    db.commit()
    db.refresh(company)
    return company
