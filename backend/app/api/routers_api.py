"""
Endpoints CRUD de routers MikroTik.
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminOnly, AdminOrTecnico, CurrentUser, DBSession
from app.core.security import decrypt_secret, encrypt_secret
from app.models.router import Router
from app.schemas.router import (
    RouterCreate,
    RouterRead,
    RouterStatus,
    RouterTestPayload,
    RouterTestResult,
    RouterUpdate,
)
from app.services.mikrotik.health import check_router_health, get_cached_router_status
from app.services.mikrotik.router_pool import RouterConnectionError, router_pool

router = APIRouter(prefix="/routers", tags=["routers"])


def _enrich_with_status(r: Router, cached: RouterStatus | None) -> dict:
    """Combina datos del modelo con el estado cacheado de Redis."""
    data = RouterRead.model_validate(r).model_dump()
    if cached:
        data["status"] = cached.status
        data["uptime"] = cached.uptime
        data["ros_version"] = cached.ros_version
    else:
        data["status"] = "unknown"
    return data


@router.get("", response_model=list[RouterRead])
async def list_routers(db: DBSession, _: CurrentUser) -> list:
    routers = db.query(Router).filter(Router.activo == True).order_by(Router.nombre).all()
    result = []
    for r in routers:
        cached = await get_cached_router_status(str(r.id))
        result.append(_enrich_with_status(r, cached))
    return result


@router.post("", response_model=RouterRead, status_code=status.HTTP_201_CREATED)
def create_router(payload: RouterCreate, db: DBSession, _: AdminOnly) -> Router:
    r = Router(
        nombre=payload.nombre,
        ip=payload.ip,
        puerto_api=payload.puerto_api,
        usuario_api=payload.usuario_api,
        password_enc=encrypt_secret(payload.password_api),
        activo=payload.activo,
        modelo_hw=payload.modelo_hw,
        notas=payload.notas,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.post("/test-connection", response_model=RouterTestResult)
def test_unsaved_router_connection(
    payload: RouterTestPayload,
    db: DBSession,
    _: AdminOnly,
) -> RouterTestResult:
    """
    Prueba la conexión al router usando datos del formulario (antes de guardar o al editar).
    """
    password = payload.password_api
    if not password:
        if payload.router_id:
            r = db.get(Router, payload.router_id)
            if not r:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
            try:
                password = decrypt_secret(r.password_enc)
            except Exception as e:
                return RouterTestResult(
                    success=False,
                    message="Error al descifrar la contraseña guardada en la base de datos",
                    error=str(e),
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Se requiere la contraseña para probar la conexión de un nuevo router",
            )

    temp_router = Router(
        nombre=f"Test-{payload.ip}",
        ip=payload.ip,
        puerto_api=payload.puerto_api,
        usuario_api=payload.usuario_api,
        password_enc=encrypt_secret(password),
    )

    try:
        with router_pool.connect_to(temp_router) as api_conn:
            sys_res = list(api_conn("/system/resource/print"))
            ros_version = sys_res[0].get("version") if sys_res else None
            uptime = sys_res[0].get("uptime") if sys_res else None

        return RouterTestResult(
            success=True,
            message=f"Conexión exitosa a {payload.ip}:{payload.puerto_api}",
            ros_version=ros_version,
            uptime=uptime,
        )
    except RouterConnectionError as e:
        return RouterTestResult(
            success=False,
            message=f"No se pudo conectar a {payload.ip}:{payload.puerto_api}",
            error=str(e),
        )


@router.get("/{router_id}", response_model=RouterRead)
async def get_router(router_id: uuid.UUID, db: DBSession, _: CurrentUser) -> dict:
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    cached = await get_cached_router_status(str(r.id))
    return _enrich_with_status(r, cached)


@router.put("/{router_id}", response_model=RouterRead)
def update_router(
    router_id: uuid.UUID, payload: RouterUpdate, db: DBSession, _: AdminOnly
) -> Router:
    r = db.get(Router, router_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    if "password_api" in update_data:
        update_data["password_enc"] = encrypt_secret(update_data.pop("password_api"))

    for field, value in update_data.items():
        setattr(r, field, value)

    db.commit()
    db.refresh(r)
    return r


@router.delete("/{router_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_router(router_id: uuid.UUID, db: DBSession, _: AdminOnly) -> None:
    r = db.get(Router, router_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    # Soft delete
    r.activo = False
    db.commit()


@router.get("/{router_id}/status", response_model=RouterStatus)
async def get_router_status(router_id: uuid.UUID, db: DBSession, _: AdminOrTecnico) -> RouterStatus:
    """
    Devuelve el estado en tiempo real del router (ping live a RouterOS).
    También actualiza la caché de Redis.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    return await check_router_health(r)


@router.post("/{router_id}/test-connection", response_model=RouterTestResult)
def test_router_connection(router_id: uuid.UUID, db: DBSession, _: AdminOnly) -> RouterTestResult:
    """
    Prueba la conexión al router desde el formulario UI.
    Respuesta síncrona para feedback inmediato.
    """
    r = db.get(Router, router_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    try:
        with router_pool.connect_to(r) as api:
            sys_res = list(api("/system/resource/print"))
            ros_version = sys_res[0].get("version") if sys_res else None
            uptime = sys_res[0].get("uptime") if sys_res else None

        return RouterTestResult(
            success=True,
            message=f"Conexión exitosa a {r.nombre} ({r.ip}:{r.puerto_api})",
            ros_version=ros_version,
            uptime=uptime,
        )
    except RouterConnectionError as e:
        return RouterTestResult(
            success=False,
            message=f"No se pudo conectar a {r.nombre}",
            error=str(e),
        )
