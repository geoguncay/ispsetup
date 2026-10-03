"""
Endpoints CRUD de balanceadores de carga.
"""
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.core.deps import AdminOnly, CurrentUser, DBSession, get_db
from app.core.redis import LB_INTERFACES_PREFIX, redis_client
from app.core.security import decrypt_secret, decode_token, encrypt_secret
from app.models.load_balancer import LoadBalancer
from app.models.load_balancer_script_run import LoadBalancerScriptRun
from app.models.site import Site
from app.models.user import User
from app.schemas.load_balancer import (
    LoadBalancerBalancingUpdate,
    LoadBalancerCreate,
    LoadBalancerInterfaceRead,
    LoadBalancerRead,
    LoadBalancerScriptApplyResult,
    LoadBalancerScriptRunRead,
    LoadBalancerStatus,
    LoadBalancerTestPayload,
    LoadBalancerTestResult,
    LoadBalancerUpdate,
)
from app.services.audit_service import AuditAction, audit_detail, log_event
from app.services.load_balancer.health import check_load_balancer_health, get_cached_load_balancer_status
from app.services.load_balancer.script_builder import (
    ScriptBuilderError,
    WanLink as WanLinkDC,
    build_script,
)
from app.services.load_balancer.script_runner import (
    LoadBalancerScriptError,
    apply_built_script,
)
from app.services.router.router_pool import RouterConnectionError, router_pool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/load-balancers", tags=["load-balancers"])


def _resolve_site(db: DBSession, site_id: uuid.UUID | None, new_site_name: str | None) -> uuid.UUID | None:
    """Reutiliza o crea un Sitio, igual que el flujo de alta/edición de Router."""
    if new_site_name and new_site_name.strip():
        clean_name = new_site_name.strip()
        existing_site = db.query(Site).filter(Site.name == clean_name).first()
        if existing_site:
            return existing_site.id
        new_site = Site(name=clean_name)
        db.add(new_site)
        db.flush()
        return new_site.id
    return site_id


def _enrich_with_status(lb: LoadBalancer, cached: LoadBalancerStatus | None) -> dict:
    """Combina datos del modelo con el estado cacheado de Redis (igual que Router)."""
    data = LoadBalancerRead.model_validate(lb).model_dump()
    data["site_id"] = lb.site_id
    data["site_name"] = lb.site_name
    if cached:
        data["status"] = cached.status
        data["uptime"] = cached.uptime
        data["ros_version"] = cached.ros_version
        data["zerotier_online"] = cached.zerotier_online
    else:
        data["status"] = "unknown"
    return data


@router.get("", response_model=list[LoadBalancerRead])
async def list_load_balancers(db: DBSession, _: CurrentUser) -> list:
    load_balancers = (
        db.query(LoadBalancer)
        .filter(LoadBalancer.active == True)
        .order_by(LoadBalancer.name)
        .all()
    )
    result = []
    for lb in load_balancers:
        cached = await get_cached_load_balancer_status(str(lb.id))
        result.append(_enrich_with_status(lb, cached))
    return result


@router.post("", response_model=LoadBalancerRead, status_code=status.HTTP_201_CREATED)
def create_load_balancer(payload: LoadBalancerCreate, db: DBSession, current_user: AdminOnly) -> LoadBalancer:
    site_id = _resolve_site(db, payload.site_id, payload.new_site_name)

    lb = LoadBalancer(
        name=payload.name,
        ip=payload.ip,
        api_port=payload.api_port,
        api_username=payload.api_username,
        password_enc=encrypt_secret(payload.password_api),
        active=payload.active,
        hw_model=payload.hw_model,
        notes=payload.notes,
        latitude=payload.latitude,
        longitude=payload.longitude,
        site_id=site_id,
        zerotier_node_id=payload.zerotier_node_id,
    )
    db.add(lb)
    db.commit()
    db.refresh(lb)

    log_event(
        db, AuditAction.CREATE_LOAD_BALANCER,
        entity_type="LoadBalancer", entity_id=str(lb.id), entity_name=lb.name,
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Balanceador de carga creado", ip=lb.ip, api_port=lb.api_port, site=lb.site_name),
    )

    return lb


@router.post("/test-connection", response_model=LoadBalancerTestResult)
def test_unsaved_load_balancer_connection(
    payload: LoadBalancerTestPayload,
    db: DBSession,
    current_user: AdminOnly,
) -> LoadBalancerTestResult:
    """
    Prueba la conexión al balanceador usando datos del formulario (antes de guardar o al editar).
    """
    password = payload.password_api
    if not password:
        if payload.load_balancer_id:
            lb = db.get(LoadBalancer, payload.load_balancer_id)
            if not lb:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")
            try:
                password = decrypt_secret(lb.password_enc)
            except Exception as e:
                return LoadBalancerTestResult(
                    success=False,
                    message="Error al descifrar la contraseña guardada en la base de datos",
                    error=str(e),
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Se requiere la contraseña para probar la conexión de un nuevo balanceador",
            )

    temp_lb = LoadBalancer(
        name=f"Test-{payload.ip}",
        ip=payload.ip,
        api_port=payload.api_port,
        api_username=payload.api_username,
        password_enc=encrypt_secret(password),
    )

    try:
        with router_pool.connect_to(temp_lb) as api_conn:
            sys_res = list(api_conn("/system/resource/print"))
            ros_version = sys_res[0].get("version") if sys_res else None
            uptime = sys_res[0].get("uptime") if sys_res else None

        result = LoadBalancerTestResult(
            success=True,
            message=f"Conexión exitosa a {payload.ip}:{payload.api_port}",
            ros_version=ros_version,
            uptime=uptime,
        )
        log_event(
            db, AuditAction.TEST_LOAD_BALANCER_CONNECTION,
            entity_type="LoadBalancer", entity_id=payload.load_balancer_id or payload.ip,
            entity_name=temp_lb.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Prueba de conexión exitosa", ip=payload.ip, api_port=payload.api_port, success=True, ros_version=ros_version),
        )
        return result
    except RouterConnectionError as e:
        result = LoadBalancerTestResult(
            success=False,
            message=f"No se pudo conectar a {payload.ip}:{payload.api_port}",
            error=str(e),
        )
        log_event(
            db, AuditAction.TEST_LOAD_BALANCER_CONNECTION,
            entity_type="LoadBalancer", entity_id=payload.load_balancer_id or payload.ip,
            entity_name=temp_lb.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Prueba de conexión fallida", ip=payload.ip, api_port=payload.api_port, success=False, error=str(e)),
        )
        return result


@router.get("/{load_balancer_id}", response_model=LoadBalancerRead)
async def get_load_balancer(load_balancer_id: uuid.UUID, db: DBSession, _: CurrentUser) -> dict:
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb or not lb.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")
    cached = await get_cached_load_balancer_status(str(lb.id))
    return _enrich_with_status(lb, cached)


@router.get("/{load_balancer_id}/status", response_model=LoadBalancerStatus)
async def get_load_balancer_status(load_balancer_id: uuid.UUID, db: DBSession, _: CurrentUser) -> LoadBalancerStatus:
    """
    Devuelve el estado en tiempo real del balanceador (ping live a RouterOS).
    También actualiza la caché de Redis.
    """
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb or not lb.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")
    return await check_load_balancer_health(lb)


@router.put("/{load_balancer_id}", response_model=LoadBalancerRead)
def update_load_balancer(
    load_balancer_id: uuid.UUID, payload: LoadBalancerUpdate, db: DBSession, current_user: AdminOnly
) -> LoadBalancer:
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    if "password_api" in update_data:
        update_data["password_enc"] = encrypt_secret(update_data.pop("password_api"))

    new_site_name = update_data.pop("new_site_name", None)
    if new_site_name and new_site_name.strip():
        lb.site_id = _resolve_site(db, None, new_site_name)
        update_data.pop("site_id", None)
    elif "site_id" in update_data:
        lb.site_id = update_data.pop("site_id")

    for field, value in update_data.items():
        setattr(lb, field, value)

    db.commit()
    db.refresh(lb)

    log_event(
        db, AuditAction.UPDATE_LOAD_BALANCER,
        entity_type="LoadBalancer", entity_id=str(lb.id), entity_name=lb.name,
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Balanceador de carga actualizado", fields_changed=sorted(payload.model_fields_set)),
    )

    return lb


@router.delete("/{load_balancer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_load_balancer(load_balancer_id: uuid.UUID, db: DBSession, current_user: AdminOnly) -> None:
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")

    lb.active = False
    db.commit()

    log_event(
        db, AuditAction.DELETE_LOAD_BALANCER,
        entity_type="LoadBalancer", entity_id=str(load_balancer_id), entity_name=lb.name,
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Balanceador de carga eliminado"),
    )


@router.post("/{load_balancer_id}/test-connection", response_model=LoadBalancerTestResult)
def test_load_balancer_connection(load_balancer_id: uuid.UUID, db: DBSession, current_user: AdminOnly) -> LoadBalancerTestResult:
    """
    Prueba la conexión al balanceador ya guardado, desde el formulario UI.
    """
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")

    try:
        with router_pool.connect_to(lb) as api:
            sys_res = list(api("/system/resource/print"))
            ros_version = sys_res[0].get("version") if sys_res else None
            uptime = sys_res[0].get("uptime") if sys_res else None

        result = LoadBalancerTestResult(
            success=True,
            message=f"Conexión exitosa a {lb.name} ({lb.ip}:{lb.api_port})",
            ros_version=ros_version,
            uptime=uptime,
        )
        log_event(
            db, AuditAction.TEST_LOAD_BALANCER_CONNECTION,
            entity_type="LoadBalancer", entity_id=lb.id, entity_name=lb.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Prueba de conexión exitosa", ip=lb.ip, api_port=lb.api_port, success=True, ros_version=ros_version),
        )
        return result
    except RouterConnectionError as e:
        result = LoadBalancerTestResult(
            success=False,
            message=f"No se pudo conectar a {lb.name}",
            error=str(e),
        )
        log_event(
            db, AuditAction.TEST_LOAD_BALANCER_CONNECTION,
            entity_type="LoadBalancer", entity_id=lb.id, entity_name=lb.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Prueba de conexión fallida", ip=lb.ip, api_port=lb.api_port, success=False, error=str(e)),
        )
        return result


@router.put("/{load_balancer_id}/balancing", response_model=LoadBalancerRead)
def update_load_balancing_config(
    load_balancer_id: uuid.UUID, payload: LoadBalancerBalancingUpdate, db: DBSession, current_user: AdminOnly
) -> LoadBalancer:
    """
    Guarda el algoritmo y los enlaces WAN del balanceador. No toca RouterOS —
    para aplicar la configuración en el equipo, ver POST .../apply-template.
    """
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb or not lb.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")

    lb.algorithm = payload.algorithm
    lb.wan_links = [link.model_dump() for link in payload.wan_links]
    db.commit()
    db.refresh(lb)

    log_event(
        db, AuditAction.UPDATE_LOAD_BALANCER,
        entity_type="LoadBalancer", entity_id=str(lb.id), entity_name=lb.name,
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Configuración de balanceo actualizada", algorithm=lb.algorithm, wan_links=lb.wan_links),
    )
    return lb


def _record_script_run(
    db: DBSession,
    lb: LoadBalancer,
    *,
    origin: str,
    algorithm: str | None,
    source: str,
    success: bool,
    output: str | None,
    current_user,
) -> LoadBalancerScriptRun:
    run = LoadBalancerScriptRun(
        load_balancer_id=lb.id,
        origin=origin,
        algorithm=algorithm,
        source=source,
        success=success,
        output=output,
        executed_by_id=current_user.id,
        executed_by_name=current_user.name,
    )
    db.add(run)
    lb.last_script_source = source
    lb.last_script_applied_at = datetime.now(timezone.utc)
    lb.last_script_status = "success" if success else "error"
    db.commit()
    db.refresh(run)
    return run


@router.post("/{load_balancer_id}/apply-template", response_model=LoadBalancerScriptApplyResult)
def apply_balancing_template(
    load_balancer_id: uuid.UUID, db: DBSession, current_user: AdminOnly
) -> LoadBalancerScriptApplyResult:
    """
    Genera el script RouterOS según el algoritmo y los enlaces WAN ya guardados
    (ver PUT .../balancing) y lo aplica en el balanceador.
    """
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb or not lb.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")
    if not lb.wan_links or len(lb.wan_links) < 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Configura al menos 2 enlaces WAN antes de aplicar una plantilla de balanceo",
        )

    wan_links = [WanLinkDC(**link) for link in lb.wan_links]
    try:
        built = build_script(lb.algorithm, wan_links)
    except ScriptBuilderError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    try:
        apply_built_script(lb, built)
    except LoadBalancerScriptError as exc:
        _record_script_run(
            db, lb, origin="template", algorithm=lb.algorithm,
            source=built.text, success=False, output=str(exc), current_user=current_user,
        )
        log_event(
            db, AuditAction.APPLY_LOAD_BALANCER_SCRIPT,
            entity_type="LoadBalancer", entity_id=lb.id, entity_name=lb.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Plantilla de balanceo fallida", algorithm=lb.algorithm, success=False, error=str(exc)),
        )
        return LoadBalancerScriptApplyResult(
            success=False,
            message="No se pudo aplicar la plantilla en el balanceador",
            source=built.text,
            output=str(exc),
        )

    _record_script_run(
        db, lb, origin="template", algorithm=lb.algorithm,
        source=built.text, success=True, output=None, current_user=current_user,
    )
    log_event(
        db, AuditAction.APPLY_LOAD_BALANCER_SCRIPT,
        entity_type="LoadBalancer", entity_id=lb.id, entity_name=lb.name,
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Plantilla de balanceo aplicada", algorithm=lb.algorithm, success=True),
    )
    return LoadBalancerScriptApplyResult(
        success=True,
        message="Plantilla de balanceo aplicada correctamente",
        source=built.text,
    )


@router.get("/{load_balancer_id}/script-runs", response_model=list[LoadBalancerScriptRunRead])
def list_script_runs(
    load_balancer_id: uuid.UUID, db: DBSession, _: CurrentUser, limit: int = 50
) -> list:
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")
    return (
        db.query(LoadBalancerScriptRun)
        .filter(LoadBalancerScriptRun.load_balancer_id == load_balancer_id)
        .order_by(LoadBalancerScriptRun.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/{load_balancer_id}/interfaces", response_model=list[LoadBalancerInterfaceRead])
async def get_load_balancer_interfaces(load_balancer_id: uuid.UUID, db: DBSession, _: CurrentUser) -> list:
    """
    Devuelve el último snapshot de TODAS las interfaces del balanceador (estado
    up/down, consumo acumulado, tasa bps actual), cacheado en Redis por la tarea
    Celery `poll_lb_interfaces` (cada 5s). Lista vacía si aún no se ha sondeado.
    """
    lb = db.get(LoadBalancer, load_balancer_id)
    if not lb or not lb.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Balanceador no encontrado")

    cached = await redis_client.get(f"{LB_INTERFACES_PREFIX}{load_balancer_id}")
    if cached is None:
        return []
    return json.loads(cached)


@router.websocket("/ws/{load_balancer_id}")
async def websocket_lb_traffic_endpoint(
    websocket: WebSocket,
    load_balancer_id: uuid.UUID,
    token: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """
    WebSocket que retransmite en tiempo real el snapshot de interfaces del
    balanceador, publicado por la tarea Celery `poll_lb_interfaces` en Redis
    Pub/Sub. Mismo patrón que traffic_api.websocket_traffic_endpoint.
    """
    await websocket.accept()

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        user_id_str = payload.get("sub")
        if not user_id_str:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        user_id = uuid.UUID(user_id_str)
        user = db.query(User).filter(User.id == user_id, User.active == True).first()
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if user.role not in ("admin", "technician"):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception as auth_err:
        logger.warning(f"Fallo de autenticación en WebSocket para balanceador {load_balancer_id}: {auth_err}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    channel_name = f"lb_traffic:{load_balancer_id}"
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(channel_name)

    try:
        async for message in pubsub.listen():
            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                await websocket.send_text(data)
    except WebSocketDisconnect:
        logger.debug(f"Conexión WebSocket cerrada por el cliente para balanceador: {load_balancer_id}")
    except Exception as e:
        logger.error(f"Error en WebSocket de tráfico para balanceador {load_balancer_id}: {e}")
    finally:
        try:
            await pubsub.unsubscribe(channel_name)
            await pubsub.close()
        except Exception:
            pass
