"""
Endpoints CRUD de routers.
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminOnly, AdminOrTechnician, CurrentUser, DBSession
from app.core.security import decrypt_secret, encrypt_secret
from app.models.router import Router
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.router_sync_queue import RouterSyncQueue
from app.models.site import Site
from app.models.static_ip import StaticIP
from app.models.traffic_sample import TrafficSample
from app.models.pppoe_profile import PPPoEProfile
from app.models.pppoe_secret import PPPoESecret
from app.schemas.pppoe import PPPoEProfileRead, PPPoESessionActive
from app.services.router.pppoe import (
    sync_pppoe_profiles_from_router,
    fetch_active_pppoe_sessions,
    disconnect_pppoe_session,
)
from app.services.router.address_list import fetch_clients_from_address_list
from app.services.router.queue import fetch_queues, get_parent_queue_limit, update_parent_queue_limit
from app.schemas.router import (
    RouterCreate,
    RouterRead,
    RouterStatus,
    RouterSettingsUpdate,
    RouterTestPayload,
    RouterTestResult,
    RouterUpdate,
)
from app.services.router.health import check_router_health, get_cached_router_status
from app.services.audit_service import AuditAction, audit_detail, log_event
from app.services.router.router_pool import RouterConnectionError, router_pool
from app.services.router.router_configuration import (
    RouterConfigurationError,
    apply_router_configuration,
    cleanup_router_configuration,
)

router = APIRouter(prefix="/routers", tags=["routers"])


def _enrich_with_status(r: Router, cached: RouterStatus | None) -> dict:
    """Combina datos del modelo con el estado cacheado de Redis."""
    data = RouterRead.model_validate(r).model_dump()
    data["site_id"] = r.site_id
    data["site_name"] = r.site_name
    if cached:
        data["status"] = cached.status
        data["uptime"] = cached.uptime
        data["ros_version"] = cached.ros_version
        data["zerotier_online"] = cached.zerotier_online
    else:
        data["status"] = "unknown"
    return data


@router.get("", response_model=list[RouterRead])
async def list_routers(db: DBSession, _: CurrentUser) -> list:
    routers = db.query(Router).filter(Router.active == True).order_by(Router.name).all()
    result = []
    for r in routers:
        cached = await get_cached_router_status(str(r.id))
        result.append(_enrich_with_status(r, cached))
    return result


@router.post("", response_model=RouterRead, status_code=status.HTTP_201_CREATED)
def create_router(payload: RouterCreate, db: DBSession, current_user: AdminOnly) -> Router:
    # Manejar creación o asignación de Sitio
    site_id = payload.site_id
    if payload.new_site_name and payload.new_site_name.strip():
        new_site_name = payload.new_site_name.strip()
        existing_site = db.query(Site).filter(Site.name == new_site_name).first()
        if existing_site:
            site_id = existing_site.id
        else:
            new_site = Site(name=new_site_name)
            db.add(new_site)
            db.flush()
            site_id = new_site.id

    r = Router(
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
        traffic_monitoring=payload.traffic_monitoring,
        speed_control=payload.speed_control,
        sync_logs=payload.sync_logs,
        alert_notifications=payload.alert_notifications,
        security_mode=payload.security_mode,
        traffic_accounting=payload.traffic_accounting,
        speed_control_type=payload.speed_control_type,
        settings_configured=False,
        resource_config=None,
        parent_queue=None,
        address_list=None,
        suspend_list=None,
        config_mode="system",
        bandwidth_up=0,
        bandwidth_down=0,
        site_id=site_id,
        zerotier_node_id=payload.zerotier_node_id,
    )
    db.add(r)
    db.commit()
    db.refresh(r)

    log_event(
        db, AuditAction.CREATE_GATEWAY,
        entity_type="Router", entity_id=str(r.id), entity_name=r.name,
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Router creado", ip=r.ip, api_port=r.api_port, site=r.site_name),
    )

    return r


@router.post("/test-connection", response_model=RouterTestResult)
def test_unsaved_router_connection(
    payload: RouterTestPayload,
    db: DBSession,
    current_user: AdminOnly,
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
        name=f"Test-{payload.ip}",
        ip=payload.ip,
        api_port=payload.api_port,
        api_username=payload.api_username,
        password_enc=encrypt_secret(password),
    )

    try:
        with router_pool.connect_to(temp_router) as api_conn:
            sys_res = list(api_conn("/system/resource/print"))
            ros_version = sys_res[0].get("version") if sys_res else None
            uptime = sys_res[0].get("uptime") if sys_res else None

        result = RouterTestResult(
            success=True,
            message=f"Conexión exitosa a {payload.ip}:{payload.api_port}",
            ros_version=ros_version,
            uptime=uptime,
        )
        log_event(
            db, AuditAction.TEST_GATEWAY_CONNECTION,
            entity_type="Router", entity_id=payload.router_id or payload.ip,
            entity_name=temp_router.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Prueba de conexión exitosa", ip=payload.ip, api_port=payload.api_port, success=True, ros_version=ros_version),
        )
        return result
    except RouterConnectionError as e:
        result = RouterTestResult(
            success=False,
            message=f"No se pudo conectar a {payload.ip}:{payload.api_port}",
            error=str(e),
        )
        log_event(
            db, AuditAction.TEST_GATEWAY_CONNECTION,
            entity_type="Router", entity_id=payload.router_id or payload.ip,
            entity_name=temp_router.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Prueba de conexión fallida", ip=payload.ip, api_port=payload.api_port, success=False, error=str(e)),
        )
        return result


@router.get("/{router_id}", response_model=RouterRead)
async def get_router(router_id: uuid.UUID, db: DBSession, _: CurrentUser) -> dict:
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    cached = await get_cached_router_status(str(r.id))
    return _enrich_with_status(r, cached)


@router.put("/{router_id}", response_model=RouterRead)
def update_router(
    router_id: uuid.UUID, payload: RouterUpdate, db: DBSession, current_user: AdminOnly
) -> Router:
    r = db.get(Router, router_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    # Guardar el nombre anterior de la cola padre antes de actualizar
    old_parent_queue = r.parent_queue

    update_data = payload.model_dump(exclude_unset=True)
    if "password_api" in update_data:
        update_data["password_enc"] = encrypt_secret(update_data.pop("password_api"))

    # Manejar creación o asignación de Sitio
    if "new_site_name" in update_data and update_data["new_site_name"] and update_data["new_site_name"].strip():
        new_site_name = update_data.pop("new_site_name").strip()
        existing_site = db.query(Site).filter(Site.name == new_site_name).first()
        if existing_site:
            r.site_id = existing_site.id
        else:
            new_site = Site(name=new_site_name)
            db.add(new_site)
            db.flush()
            r.site_id = new_site.id
        # Remover site_id si también viene en el dict para evitar sobreescribir
        update_data.pop("site_id", None)
    elif "site_id" in update_data:
        r.site_id = update_data.pop("site_id")

    for field, value in update_data.items():
        setattr(r, field, value)

    # Saneamiento manual si cambian nombres
    if "name" in update_data and (not r.parent_queue or not r.address_list):
        clean_name = r.name.strip().lower().replace(" ", "_")
        import re
        clean_name = re.sub(r'[^a-z0-9_-]', '', clean_name)
        if not r.parent_queue:
            r.parent_queue = f"Clients{clean_name}"
        if not r.address_list:
            r.address_list = f"clients{clean_name}"

    router_mode = r.config_mode == 'router'
    if not router_mode:
        if "parent_queue" in update_data and r.parent_queue:
            if not r.parent_queue.startswith("isp_"):
                r.parent_queue = f"isp_{r.parent_queue}"

        if "address_list" in update_data and r.address_list:
            if not r.address_list.startswith("isp_"):
                r.address_list = f"isp_{r.address_list}"

        if "suspend_list" in update_data and r.suspend_list:
            if not r.suspend_list.startswith("isp_"):
                r.suspend_list = f"isp_{r.suspend_list}"

    try:
        apply_router_configuration(r, set(update_data))
    except RouterConfigurationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo aplicar la configuración en MikroTik: {exc}",
        ) from exc

    db.commit()
    db.refresh(r)

    # Sincronizar cola padre en MikroTik si el control de velocidad está activo
    if r.speed_control and r.speed_control_type == 'simple_queues':
        from app.services.router.queue import sync_router_parent_queue
        try:
            sync_router_parent_queue(r, old_parent_name=old_parent_queue)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"No se pudo actualizar la cola padre en MikroTik para el router: {e}")
            pass

    log_event(
        db, AuditAction.UPDATE_GATEWAY,
        entity_type="Router", entity_id=str(r.id), entity_name=r.name,
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Router actualizado", fields_changed=sorted(payload.model_fields_set)),
    )

    return r


@router.put("/{router_id}/settings", response_model=RouterRead)
def update_router_settings(
    router_id: uuid.UUID,
    payload: RouterSettingsUpdate,
    db: DBSession,
    current_user: AdminOnly,
) -> Router:
    """Guarda y aplica los tres modos operativos del Router."""
    router = db.get(Router, router_id)
    if not router or not router.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    settings = payload.model_dump(exclude_none=True)
    resource_config_supplied = "resource_config" in settings
    old_parent_name = None
    old_resource_config = None
    if resource_config_supplied:
        from app.services.router.router_resources import get_router_resource_config
        old_resource_config = get_router_resource_config(router)
        old_parent_name = old_resource_config['speed_control']['parent_queue']
    changes = {
        field
        for field, value in settings.items()
        if getattr(router, field) != value
    }
    # El primer guardado debe aplicar los tres modos aunque coincidan con los
    # defaults almacenados al crear el router.
    if not router.settings_configured:
        changes.update(settings)

    for field, value in settings.items():
        setattr(router, field, value)

    # Mantener los campos anteriores sincronizados durante la transición.
    if resource_config_supplied:
        resources = settings["resource_config"]
        router.suspend_list = resources["security"]["suspend_list"]
        router.parent_queue = resources["speed_control"]["parent_queue"]
        router.address_list = resources["speed_control"]["client_address_list"]

    try:
        if resource_config_supplied and old_resource_config:
            from app.services.router.router_configuration import migrate_router_resource_names
            migrate_router_resource_names(router, old_resource_config)
        apply_router_configuration(router, changes)
    except RouterConfigurationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo aplicar la configuración en MikroTik: {exc}",
        ) from exc

    if resource_config_supplied and router.speed_control_type == 'simple_queues':
        from app.services.router.queue import apply_simple_queue_structure, sync_router_parent_queue
        try:
            client_ips = [
                row.ip
                for row in db.query(StaticIP).filter(StaticIP.router_id == router.id).all()
            ]
            apply_simple_queue_structure(router, client_ips)
            if resources['speed_control']['simple_queue_structure'] == 'parented':
                sync_router_parent_queue(router, old_parent_name=old_parent_name)
        except Exception as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"No se pudo aplicar la estructura de colas en MikroTik: {exc}",
            ) from exc

    router.settings_configured = True
    db.commit()
    db.refresh(router)
    log_event(
        db,
        AuditAction.UPDATE_GATEWAY,
        entity_type="Router",
        entity_id=str(router.id),
        entity_name=router.name,
        user_id=current_user.id,
        user_name=current_user.name,
        detail={"changed_settings": sorted(changes)},
    )
    return router


@router.delete("/{router_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_router(
    router_id: uuid.UUID,
    db: DBSession,
    current_user: AdminOnly,
    cleanup_routeros: bool = False,
    delete_historical_data: bool = False,
    confirmation: str | None = None,
) -> None:
    router = db.get(Router, router_id)
    if not router:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    if delete_historical_data and confirmation != router.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La confirmación no coincide con el nombre del Router.",
        )

    cleanup_summary = None
    if cleanup_routeros:
        client_ips = [
            row.ip for row in db.query(StaticIP).filter(StaticIP.router_id == router_id).all()
        ]
        ppp_usernames = [
            row.ppp_username
            for row in db.query(PPPoESecret).filter(PPPoESecret.router_id == router_id).all()
        ]
        ppp_profile_names = [
            row.name
            for row in db.query(PPPoEProfile).filter(PPPoEProfile.router_id == router_id).all()
        ]
        try:
            cleanup_summary = cleanup_router_configuration(
                router, client_ips, ppp_usernames, ppp_profile_names
            )
        except RouterConfigurationError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"No se pudo limpiar la configuración en RouterOS: {exc}",
            ) from exc

    router_name = router.name
    client_ids = [row.id for row in db.query(Client).filter(Client.router_id == router_id).all()]

    if delete_historical_data:
        # TrafficSample usa particiones en PostgreSQL; se elimina explícitamente antes
        # de borrar clientes y Router para que el flujo también funcione en SQLite tests.
        db.query(TrafficSample).filter(TrafficSample.router_id == router_id).delete(
            synchronize_session=False
        )
        db.query(RouterSyncQueue).filter(RouterSyncQueue.router_id == router_id).delete(
            synchronize_session=False
        )
        related_entity_ids = [str(router_id), *(str(client_id) for client_id in client_ids)]
        db.query(AuditLog).filter(AuditLog.entity_id.in_(related_entity_ids)).delete(
            synchronize_session=False
        )
        for client in db.query(Client).filter(Client.router_id == router_id).all():
            db.delete(client)
        db.flush()
        db.delete(router)
    else:
        router.active = False
    db.commit()
    log_event(
        db, AuditAction.DELETE_GATEWAY,
        entity_type="Router", entity_id=str(router_id), entity_name=router_name,
        user_id=current_user.id, user_name=current_user.name,
        detail={
            "routeros_configuration": "removed" if cleanup_routeros else "preserved",
            "historical_data": "removed" if delete_historical_data else "preserved",
            "cleanup_summary": cleanup_summary,
            "deleted_clients": len(client_ids) if delete_historical_data else 0,
        },
    )


@router.get("/{router_id}/status", response_model=RouterStatus)
async def get_router_status(router_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> RouterStatus:
    """
    Devuelve el estado en tiempo real del router (ping live a RouterOS).
    También actualiza la caché de Redis.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    return await check_router_health(r)


@router.post("/{router_id}/test-connection", response_model=RouterTestResult)
def test_router_connection(router_id: uuid.UUID, db: DBSession, current_user: AdminOnly) -> RouterTestResult:
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

        result = RouterTestResult(
            success=True,
            message=f"Conexión exitosa a {r.name} ({r.ip}:{r.api_port})",
            ros_version=ros_version,
            uptime=uptime,
        )
        log_event(
            db, AuditAction.TEST_GATEWAY_CONNECTION,
            entity_type="Router", entity_id=r.id, entity_name=r.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Prueba de conexión exitosa", ip=r.ip, api_port=r.api_port, success=True, ros_version=ros_version),
        )
        return result
    except RouterConnectionError as e:
        result = RouterTestResult(
            success=False,
            message=f"No se pudo conectar a {r.name}",
            error=str(e),
        )
        log_event(
            db, AuditAction.TEST_GATEWAY_CONNECTION,
            entity_type="Router", entity_id=r.id, entity_name=r.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Prueba de conexión fallida", ip=r.ip, api_port=r.api_port, success=False, error=str(e)),
        )
        return result


@router.get("/{router_id}/logs")
def get_router_logs(
    router_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician,
    limit: int = 100,
) -> dict:
    """
    Obtiene las últimas entradas del log del sistema RouterOS.
    Solo disponible cuando Debug está activo en Ajustes → API del router.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    try:
        with router_pool.connect_to(r) as api_conn:
            raw = list(api_conn("/log/print"))
        entries = raw[-limit:] if len(raw) > limit else raw
        return {"logs": entries, "total": len(raw)}
    except RouterConnectionError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))


@router.get("/{router_id}/address-lists", response_model=list[str])
def get_router_address_lists(router_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list[str]:
    """
    Obtiene los nombres de todas las address-lists del router.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    try:
        with router_pool.connect_to(r) as api_conn:
            entries = list(api_conn.path('/ip/firewall/address-list'))
            lists = sorted(list(set(entry.get("list") for entry in entries if entry.get("list"))))
            return lists
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )


@router.post("/{router_id}/import-clients", response_model=dict)
def import_clients_from_router(
    router_id: uuid.UUID,
    db: DBSession,
    current_user: AdminOnly,
    list_name: str = "clientes"
) -> dict:
    """
    Importa clientes de una address-list de MikroTik especificada a la base de datos,
    y los agrega a la lista 'clientes' del router como clientes nuevos.
    Genera cédulas ecuatorianas válidas de forma determinista para cumplir con el esquema.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    try:
        raw_clients = fetch_clients_from_address_list(r, list_name)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )

    imported_count = 0
    from app.services.router.address_list import sync_ip_in_address_list

    def generate_dummy_cedula(idx: int) -> str:
        # Generar una cédula válida ecuatoriana con prefijo 30
        base = f"3099999{idx:02d}"
        coefs = [2, 1, 2, 1, 2, 1, 2, 1, 2]
        suma = 0
        for i in range(9):
            val = int(base[i]) * coefs[i]
            if val >= 10:
                val -= 9
            suma += val
        residuo = suma % 10
        check_digit = 0 if residuo == 0 else 10 - residuo
        return f"{base}{check_digit}"

    existing_imported_count = db.query(Client).filter(Client.cedula.like("3099999%")).count()

    for rc in raw_clients:
        ip = rc["ip"]
        comment = rc["comment"]

        # Validar si la IP ya existe registrada en este router
        exists_ip = db.query(StaticIP).filter(
            StaticIP.router_id == router_id,
            StaticIP.ip == ip
        ).first()

        if exists_ip:
            continue

        name = comment if comment else f"Importado IP {ip}"
        cedula = generate_dummy_cedula(existing_imported_count + imported_count)

        # Crear Cliente
        client = Client(
            full_name=name,
            cedula=cedula,
            phone="0999999999",
            address="Importado desde el router",
            router_id=router_id,
            connection_type="static",
            active=True,
        )
        db.add(client)
        db.flush()

        # Crear StaticIP
        static_ip = StaticIP(
            client_id=client.id,
            ip=ip,
            router_id=router_id,
            notes=f"Importado automáticamente desde lista '{list_name}'"
        )
        db.add(static_ip)

        # Sincronizar (agregar) a la lista 'clientes' en MikroTik si no es la misma
        try:
            sync_ip_in_address_list(r, ip, name)
        except Exception as e:
            # Continuar incluso si falla la escritura en el router para no romper la importación
            pass

        imported_count += 1

    db.commit()
    log_event(
        db, AuditAction.IMPORT_CLIENTS,
        entity_type="Router", entity_id=str(router_id), entity_name=r.name,
        user_id=current_user.id, user_name=current_user.name,
        detail={"imported_count": imported_count, "list_name": list_name},
    )
    return {"status": "success", "imported_count": imported_count}


@router.get("/{router_id}/queues", response_model=list[dict])
def get_router_queues(router_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list[dict]:
    """
    Obtiene la lista de colas del router, enriqueciéndolas con el cliente_id,
    nombre de cliente y plan_activo de la base de datos basándose en el target IP.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    try:
        queues = fetch_queues(r)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )

    # Obtener todos los clientes asociados a este router que tengan IP estática
    db_clients = (
        db.query(Client)
        .join(StaticIP, Client.id == StaticIP.client_id)
        .filter(Client.router_id == router_id)
        .all()
    )

    # Mapeo de IP -> Datos del cliente
    from app.models.client_plan import ClientPlan
    client_map = {}
    for client in db_clients:
        if client.static_ip:
            active_plan = (
                db.query(ClientPlan)
                .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
                .first()
            )
            plan_info = {
                "id": active_plan.plan.id if active_plan and active_plan.plan else None,
                "name": active_plan.plan.name if active_plan and active_plan.plan else "Sin plan"
            }
            client_map[client.static_ip.ip] = {
                "id": client.id,
                "name": client.full_name,
                "plan": plan_info
            }

    def format_bps(bps_str: str) -> str:
        try:
            up, down = bps_str.split('/')
            up_val = int(up)
            down_val = int(down)
            
            def to_human(val: int) -> str:
                if val >= 1000000:
                    return f"{val / 1000000:.1f} Mbps"
                elif val >= 1000:
                    return f"{val / 1000:.1f} Kbps"
                else:
                    return f"{val} bps"
            
            return f"↑ {to_human(up_val)} / ↓ {to_human(down_val)}"
        except Exception:
            return bps_str

    enriched_queues = []
    for q in queues:
        target = q.get("target", "")
        ip = target.split('/')[0] if '/' in target else target
        
        client_info = client_map.get(ip)
        
        q_data = {
            "id": q.get("id"),
            "name": q.get("name"),
            "target": target,
            "max_limit": q.get("max_limit"),
            "rate": q.get("rate"),
            "rate_human": format_bps(q.get("rate", "0/0")),
            "parent": q.get("parent"),
            "queue_type": q.get("queue_type"),
            "comment": q.get("comment"),
            "disabled": q.get("disabled"),
            "client_id": client_info["id"] if client_info else None,
            "client_name": client_info["name"] if client_info else None,
            "plan_activo": client_info["plan"] if client_info else None,
        }
        enriched_queues.append(q_data)

    return enriched_queues


@router.get("/{router_id}/parent-queue", response_model=dict)
def get_parent_queue(router_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> dict:
    """
    Obtiene el límite de velocidad actual de la cola simple padre ('PADRE' o 'total').
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    from app.services.router.router_resources import get_router_resource_config
    if get_router_resource_config(r)['speed_control']['simple_queue_structure'] != 'parented':
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este router utiliza colas simples independientes y no tiene cola padre",
        )

    try:
        return get_parent_queue_limit(r)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )


@router.post("/{router_id}/parent-queue", response_model=dict)
def set_parent_queue_limit(
    router_id: uuid.UUID,
    limit_up_mbps: int,
    limit_down_mbps: int,
    db: DBSession,
    current_user: AdminOnly
) -> dict:
    """
    Establece los límites de velocidad de subida/bajada de la cola simple padre en MikroTik.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    from app.services.router.router_resources import get_router_resource_config
    if get_router_resource_config(r)['speed_control']['simple_queue_structure'] != 'parented':
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este router utiliza colas simples independientes y no tiene cola padre",
        )

    try:
        update_parent_queue_limit(r, limit_up_mbps, limit_down_mbps)
        log_event(
            db, AuditAction.UPDATE_GATEWAY_QUEUE,
            entity_type="Router", entity_id=r.id, entity_name=r.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Límite de cola padre actualizado", limit_up_mbps=limit_up_mbps, limit_down_mbps=limit_down_mbps),
        )
        return {"status": "success", "message": f"Cola padre configurada a {limit_up_mbps}M/{limit_down_mbps}M"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al aplicar cambios en el router: {str(e)}"
        )


@router.post("/{router_id}/sync-pppoe-profiles", response_model=dict)
def sync_router_pppoe_profiles(router_id: uuid.UUID, db: DBSession, current_user: AdminOnly) -> dict:
    """
    Sincroniza perfiles PPPoE desde el router MikroTik y los guarda en la base de datos.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    try:
        count = sync_pppoe_profiles_from_router(db, r)
        log_event(
            db, AuditAction.SYNC_PPPOE_PROFILES,
            entity_type="Router", entity_id=r.id, entity_name=r.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Perfiles PPPoE sincronizados", synchronized_count=count),
        )
        return {"status": "success", "message": f"Sincronizados {count} perfiles PPPoE exitosamente."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )


@router.get("/{router_id}/pppoe-profiles", response_model=list[PPPoEProfileRead])
def get_router_pppoe_profiles(router_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list:
    """
    Devuelve los perfiles PPPoE guardados en la BD para el router especificado.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    return db.query(PPPoEProfile).filter(PPPoEProfile.router_id == router_id).order_by(PPPoEProfile.name).all()


@router.get("/{router_id}/pppoe-sessions", response_model=list[PPPoESessionActive])
def get_router_pppoe_sessions(router_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list:
    """
    Obtiene la lista de sesiones PPPoE activas en tiempo real desde el router.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    
    try:
        return fetch_active_pppoe_sessions(r)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al obtener sesiones activas desde el router MikroTik: {str(e)}"
        )


@router.post("/{router_id}/sync-pending", response_model=dict)
def sync_pending_router(router_id: uuid.UUID, db: DBSession, current_user: AdminOrTechnician) -> dict:
    """
    Procesa la cola de operaciones MikroTik pendientes para este router.
    Se invoca manualmente o de forma automática al detectar que el router volvió a estar en línea.
    """
    from app.services.router.sync_queue import process_pending_queue, get_pending_count
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    pending_before = get_pending_count(router_id, db)
    if pending_before == 0:
        log_event(
            db, AuditAction.SYNC_GATEWAY,
            entity_type="Router", entity_id=r.id, entity_name=r.name,
            user_id=current_user.id, user_name=current_user.name,
            detail=audit_detail("Sincronización manual ejecutada", pending_before=0, processed=0, failed=0),
        )
        return {"processed": 0, "failed": 0, "total": 0, "message": "No hay operaciones pendientes."}
    result = process_pending_queue(r, db)
    log_event(
        db, AuditAction.SYNC_GATEWAY,
        entity_type="Router", entity_id=r.id, entity_name=r.name,
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Cola de sincronización procesada", pending_before=pending_before, **result),
    )
    return {**result, "message": f"Cola procesada: {result['processed']} exitosos, {result['failed']} fallidos."}


@router.get("/{router_id}/sync-pending", response_model=dict)
async def get_sync_pending_count(router_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> dict:
    """Devuelve el número de operaciones MikroTik pendientes para este router."""
    from app.services.router.sync_queue import get_pending_count
    from app.models.router_sync_queue import RouterSyncQueue
    r = db.get(Router, router_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    items = (
        db.query(RouterSyncQueue)
        .filter(RouterSyncQueue.router_id == router_id)
        .filter(RouterSyncQueue.status.in_(["pending", "failed", "done"]))
        .order_by(RouterSyncQueue.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "pending_count": get_pending_count(router_id, db),
        "items": [
            {
                "id": str(i.id),
                "operation": i.operation,
                "status": i.status,
                "attempts": i.attempts,
                "last_error": i.last_error,
                "created_at": i.created_at.isoformat() if i.created_at else None,
                "next_retry_at": i.next_retry_at.isoformat() if i.next_retry_at else None,
            }
            for i in items
        ],
    }


@router.delete("/{router_id}/pppoe-sessions/{username}", response_model=dict)
def delete_router_pppoe_session(router_id: uuid.UUID, username: str, db: DBSession, current_user: AdminOrTechnician) -> dict:
    """
    Desconecta una sesión PPPoE activa (kick) en el router especificado.
    """
    r = db.get(Router, router_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    
    try:
        success = disconnect_pppoe_session(r, username)
        if success:
            log_event(
                db, AuditAction.TERMINATE_PPPOE_SESSION,
                entity_type="Router", entity_id=r.id, entity_name=r.name,
                user_id=current_user.id, user_name=current_user.name,
                detail=audit_detail("Sesión PPPoE terminada", pppoe_username=username),
            )
            return {"status": "success", "message": f"Sesión del usuario {username} desconectada."}
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No se encontró una sesión activa para el usuario {username}."
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al desconectar la sesión activa: {str(e)}"
        )
