"""
Endpoints CRUD de Sitios (Sites).
"""
from fastapi import APIRouter, HTTPException, status

from app.core.deps import AdminOrTecnico, DBSession
from app.models.site import Site
from app.schemas.site import SiteCreate, SiteRead

router = APIRouter(prefix="/sites", tags=["sites"])


@router.get("", response_model=list[SiteRead])
def list_sites(db: DBSession, _: AdminOrTecnico) -> list:
    return db.query(Site).order_by(Site.nombre).all()


@router.post("", response_model=SiteRead, status_code=status.HTTP_201_CREATED)
def create_site(payload: SiteCreate, db: DBSession, _: AdminOrTecnico) -> Site:
    existing = db.query(Site).filter(Site.nombre == payload.nombre.strip()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un sitio con ese nombre"
        )
    site = Site(nombre=payload.nombre.strip())
    db.add(site)
    db.commit()
    db.refresh(site)
    return site
