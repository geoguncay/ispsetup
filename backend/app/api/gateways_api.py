"""
Endpoints CRUD de routers MikroTik.
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminOnly, AdminOrTechnician, CurrentUser, DBSession
from app.core.security import decrypt_secret, encrypt_secret
from app.models.gateway import Gateway
from app.models.client import Client
from app.models.site import Site
from app.models.static_ip import StaticIP
from app.models.pppoe_profile import PPPoEProfile
from app.schemas.pppoe import PPPoEProfileRead, PPPoESessionActive
from app.services.mikrotik.pppoe import (
    sync_pppoe_profiles_from_gateway,
    fetch_active_pppoe_sessions,
    disconnect_pppoe_session,
)
from app.services.mikrotik.address_list import fetch_clients_from_address_list
from app.services.mikrotik.queue import fetch_queues, get_parent_queue_limit, update_parent_queue_limit
from app.schemas.gateway import (
    GatewayCreate,
    GatewayRead,
    GatewayStatus,
    GatewayTestPayload,
    GatewayTestResult,
    GatewayUpdate,
)
from app.services.mikrotik.health import check_gateway_health, get_cached_gateway_status
from app.services.audit_service import AuditAction, log_event
from app.services.mikrotik.gateway_pool import GatewayConnectionError, gateway_pool

router = APIRouter(prefix="/gateways", tags=["gateways"])


def _enrich_with_status(r: Gateway, cached: GatewayStatus | None) -> dict:
    """Combina datos del modelo con el estado cacheado de Redis."""
    data = GatewayRead.model_validate(r).model_dump()
    data["site_id"] = r.site_id
    data["site_name"] = r.site_name
    if cached:
        data["status"] = cached.status
        data["uptime"] = cached.uptime
        data["ros_version"] = cached.ros_version
    else:
        data["status"] = "unknown"
    return data


@router.get("", response_model=list[GatewayRead])
async def list_gateways(db: DBSession, _: CurrentUser) -> list:
    gateways = db.query(Gateway).filter(Gateway.active == True).order_by(Gateway.name).all()
    result = []
    for r in gateways:
        cached = await get_cached_gateway_status(str(r.id))
        result.append(_enrich_with_status(r, cached))
    return result


@router.post("", response_model=GatewayRead, status_code=status.HTTP_201_CREATED)
def create_gateway(payload: GatewayCreate, db: DBSession, current_user: AdminOnly) -> Gateway:
    # 1. Determinar y sanear nombres de cola padre y address list
    clean_name = payload.name.strip().lower().replace(" ", "_")
    import re
    clean_name = re.sub(r'[^a-z0-9_-]', '', clean_name)

    parent_queue_name = payload.parent_queue
    if not parent_queue_name:
        parent_queue_name = f"isp_padre_{clean_name}"
    elif not parent_queue_name.startswith("isp_"):
        parent_queue_name = f"isp_{parent_queue_name}"

    address_list_name = payload.address_list
    if not address_list_name:
        address_list_name = f"isp_clientes_{clean_name}"
    elif not address_list_name.startswith("isp_"):
        address_list_name = f"isp_{address_list_name}"

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

    r = Gateway(
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
        parent_queue=parent_queue_name,
        address_list=address_list_name,
        bandwidth_up=payload.bandwidth_up or 0,
        bandwidth_down=payload.bandwidth_down or 0,
        site_id=site_id,
    )
    db.add(r)
    db.commit()
    db.refresh(r)

    # 2. Sincronizar cola padre en MikroTik si está activo
    if r.speed_control:
        from app.services.mikrotik.queue import sync_gateway_parent_queue
        try:
            sync_gateway_parent_queue(r)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"No se pudo crear cola padre en MikroTik para el router: {e}")
            pass

    log_event(
        db, AuditAction.CREATE_GATEWAY,
        entity_type="Gateway", entity_id=str(r.id), entity_name=r.name,
        user_id=current_user.id, user_name=current_user.name,
    )

    return r


@router.post("/test-connection", response_model=GatewayTestResult)
def test_unsaved_gateway_connection(
    payload: GatewayTestPayload,
    db: DBSession,
    _: AdminOnly,
) -> GatewayTestResult:
    """
    Prueba la conexión al router usando datos del formulario (antes de guardar o al editar).
    """
    password = payload.password_api
    if not password:
        if payload.gateway_id:
            r = db.get(Gateway, payload.gateway_id)
            if not r:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")
            try:
                password = decrypt_secret(r.password_enc)
            except Exception as e:
                return GatewayTestResult(
                    success=False,
                    message="Error al descifrar la contraseña guardada en la base de datos",
                    error=str(e),
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Se requiere la contraseña para probar la conexión de un nuevo router",
            )

    temp_gateway = Gateway(
        name=f"Test-{payload.ip}",
        ip=payload.ip,
        api_port=payload.api_port,
        api_username=payload.api_username,
        password_enc=encrypt_secret(password),
    )

    try:
        with gateway_pool.connect_to(temp_gateway) as api_conn:
            sys_res = list(api_conn("/system/resource/print"))
            ros_version = sys_res[0].get("version") if sys_res else None
            uptime = sys_res[0].get("uptime") if sys_res else None

        return GatewayTestResult(
            success=True,
            message=f"Conexión exitosa a {payload.ip}:{payload.api_port}",
            ros_version=ros_version,
            uptime=uptime,
        )
    except GatewayConnectionError as e:
        return GatewayTestResult(
            success=False,
            message=f"No se pudo conectar a {payload.ip}:{payload.api_port}",
            error=str(e),
        )


@router.get("/{gateway_id}", response_model=GatewayRead)
async def get_gateway(gateway_id: uuid.UUID, db: DBSession, _: CurrentUser) -> dict:
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")
    cached = await get_cached_gateway_status(str(r.id))
    return _enrich_with_status(r, cached)


@router.put("/{gateway_id}", response_model=GatewayRead)
def update_gateway(
    gateway_id: uuid.UUID, payload: GatewayUpdate, db: DBSession, current_user: AdminOnly
) -> Gateway:
    r = db.get(Gateway, gateway_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

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
            r.parent_queue = f"isp_padre_{clean_name}"
        if not r.address_list:
            r.address_list = f"isp_clientes_{clean_name}"

    if "parent_queue" in update_data and r.parent_queue:
        if not r.parent_queue.startswith("isp_"):
            r.parent_queue = f"isp_{r.parent_queue}"

    if "address_list" in update_data and r.address_list:
        if not r.address_list.startswith("isp_"):
            r.address_list = f"isp_{r.address_list}"

    db.commit()
    db.refresh(r)

    # Sincronizar cola padre en MikroTik si el control de velocidad está activo
    if r.speed_control:
        from app.services.mikrotik.queue import sync_gateway_parent_queue
        try:
            sync_gateway_parent_queue(r, old_parent_name=old_parent_queue)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"No se pudo actualizar la cola padre en MikroTik para el router: {e}")
            pass

    log_event(
        db, AuditAction.UPDATE_GATEWAY,
        entity_type="Gateway", entity_id=str(r.id), entity_name=r.name,
        user_id=current_user.id, user_name=current_user.name,
    )

    return r


@router.delete("/{gateway_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_gateway(gateway_id: uuid.UUID, db: DBSession, current_user: AdminOnly) -> None:
    r = db.get(Gateway, gateway_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")
    gateway_name = r.name
    # Soft delete
    r.active = False
    db.commit()
    log_event(
        db, AuditAction.DELETE_GATEWAY,
        entity_type="Gateway", entity_id=str(gateway_id), entity_name=gateway_name,
        user_id=current_user.id, user_name=current_user.name,
    )


@router.get("/{gateway_id}/status", response_model=GatewayStatus)
async def get_gateway_status(gateway_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> GatewayStatus:
    """
    Devuelve el estado en tiempo real del router (ping live a RouterOS).
    También actualiza la caché de Redis.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")
    return await check_gateway_health(r)


@router.post("/{gateway_id}/test-connection", response_model=GatewayTestResult)
def test_gateway_connection(gateway_id: uuid.UUID, db: DBSession, _: AdminOnly) -> GatewayTestResult:
    """
    Prueba la conexión al router desde el formulario UI.
    Respuesta síncrona para feedback inmediato.
    """
    r = db.get(Gateway, gateway_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

    try:
        with gateway_pool.connect_to(r) as api:
            sys_res = list(api("/system/resource/print"))
            ros_version = sys_res[0].get("version") if sys_res else None
            uptime = sys_res[0].get("uptime") if sys_res else None

        return GatewayTestResult(
            success=True,
            message=f"Conexión exitosa a {r.name} ({r.ip}:{r.api_port})",
            ros_version=ros_version,
            uptime=uptime,
        )
    except GatewayConnectionError as e:
        return GatewayTestResult(
            success=False,
            message=f"No se pudo conectar a {r.name}",
            error=str(e),
        )


@router.get("/{gateway_id}/logs")
def get_gateway_logs(
    gateway_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician,
    limit: int = 100,
) -> dict:
    """
    Obtiene las últimas entradas del log del sistema RouterOS.
    Solo disponible cuando Debug está activo en Ajustes → MikroTik API.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

    try:
        with gateway_pool.connect_to(r) as api_conn:
            raw = list(api_conn("/log/print"))
        entries = raw[-limit:] if len(raw) > limit else raw
        return {"logs": entries, "total": len(raw)}
    except GatewayConnectionError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))


@router.get("/{gateway_id}/address-lists", response_model=list[str])
def get_gateway_address_lists(gateway_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list[str]:
    """
    Obtiene los nombres de todas las address-lists del router.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

    try:
        with gateway_pool.connect_to(r) as api_conn:
            entries = list(api_conn.path('/ip/firewall/address-list'))
            lists = sorted(list(set(entry.get("list") for entry in entries if entry.get("list"))))
            return lists
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )


@router.post("/{gateway_id}/import-clients", response_model=dict)
def import_clients_from_gateway(
    gateway_id: uuid.UUID,
    db: DBSession,
    current_user: AdminOnly,
    list_name: str = "clientes"
) -> dict:
    """
    Importa clientes de una address-list de MikroTik especificada a la base de datos,
    y los agrega a la lista 'clientes' del router como clientes nuevos.
    Genera cédulas ecuatorianas válidas de forma determinista para cumplir con el esquema.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

    try:
        raw_clients = fetch_clients_from_address_list(r, list_name)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )

    imported_count = 0
    from app.services.mikrotik.address_list import sync_ip_in_address_list

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
            StaticIP.gateway_id == gateway_id,
            StaticIP.ip == ip
        ).first()

        if exists_ip:
            continue

        name = comment if comment else f"Importado IP {ip}"
        cedula = generate_dummy_cedula(existing_imported_count + imported_count)

        # Crear Cliente
        client = Client(
            name=name,
            cedula=cedula,
            phone="0999999999",
            address="Importado desde MikroTik",
            gateway_id=gateway_id,
            connection_type="static",
            active=True,
        )
        db.add(client)
        db.flush()

        # Crear StaticIP
        static_ip = StaticIP(
            client_id=client.id,
            ip=ip,
            gateway_id=gateway_id,
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
        entity_type="Gateway", entity_id=str(gateway_id), entity_name=r.name,
        user_id=current_user.id, user_name=current_user.name,
        detail={"imported_count": imported_count, "list_name": list_name},
    )
    return {"status": "success", "imported_count": imported_count}


@router.get("/{gateway_id}/queues", response_model=list[dict])
def get_gateway_queues(gateway_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list[dict]:
    """
    Obtiene la lista de colas del router, enriqueciéndolas con el cliente_id,
    nombre de cliente y plan_activo de la base de datos basándose en el target IP.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

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
        .filter(Client.gateway_id == gateway_id)
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
                "name": client.name,
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
            "comment": q.get("comment"),
            "disabled": q.get("disabled"),
            "client_id": client_info["id"] if client_info else None,
            "client_name": client_info["name"] if client_info else None,
            "plan_activo": client_info["plan"] if client_info else None,
        }
        enriched_queues.append(q_data)

    return enriched_queues


@router.get("/{gateway_id}/parent-queue", response_model=dict)
def get_parent_queue(gateway_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> dict:
    """
    Obtiene el límite de velocidad actual de la cola simple padre ('PADRE' o 'total').
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

    try:
        return get_parent_queue_limit(r)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )


@router.post("/{gateway_id}/parent-queue", response_model=dict)
def set_parent_queue_limit(
    gateway_id: uuid.UUID,
    limit_up_mbps: int,
    limit_down_mbps: int,
    db: DBSession,
    _: AdminOnly
) -> dict:
    """
    Establece los límites de velocidad de subida/bajada de la cola simple padre en MikroTik.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

    try:
        update_parent_queue_limit(r, limit_up_mbps, limit_down_mbps)
        return {"status": "success", "message": f"Cola padre configurada a {limit_up_mbps}M/{limit_down_mbps}M"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al aplicar cambios en el router: {str(e)}"
        )


@router.post("/{gateway_id}/sync-pppoe-profiles", response_model=dict)
def sync_gateway_pppoe_profiles(gateway_id: uuid.UUID, db: DBSession, _: AdminOnly) -> dict:
    """
    Sincroniza perfiles PPPoE desde el router MikroTik y los guarda en la base de datos.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

    try:
        count = sync_pppoe_profiles_from_gateway(db, r)
        return {"status": "success", "message": f"Sincronizados {count} perfiles PPPoE exitosamente."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )


@router.get("/{gateway_id}/pppoe-profiles", response_model=list[PPPoEProfileRead])
def get_gateway_pppoe_profiles(gateway_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list:
    """
    Devuelve los perfiles PPPoE guardados en la BD para el router especificado.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")

    return db.query(PPPoEProfile).filter(PPPoEProfile.gateway_id == gateway_id).order_by(PPPoEProfile.name).all()


@router.get("/{gateway_id}/pppoe-sessions", response_model=list[PPPoESessionActive])
def get_gateway_pppoe_sessions(gateway_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list:
    """
    Obtiene la lista de sesiones PPPoE activas en tiempo real desde el router.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")
    
    try:
        return fetch_active_pppoe_sessions(r)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al obtener sesiones activas desde el router MikroTik: {str(e)}"
        )


@router.post("/{gateway_id}/sync-pending", response_model=dict)
def sync_pending_mikrotik(gateway_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> dict:
    """
    Procesa la cola de operaciones MikroTik pendientes para este gateway.
    Se invoca manualmente o de forma automática al detectar que el gateway volvió a estar en línea.
    """
    from app.services.mikrotik.sync_queue import process_pending_queue, get_pending_count
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")
    pending_before = get_pending_count(gateway_id, db)
    if pending_before == 0:
        return {"processed": 0, "failed": 0, "total": 0, "message": "No hay operaciones pendientes."}
    result = process_pending_queue(r, db)
    return {**result, "message": f"Cola procesada: {result['processed']} exitosos, {result['failed']} fallidos."}


@router.get("/{gateway_id}/sync-pending", response_model=dict)
async def get_sync_pending_count(gateway_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> dict:
    """Devuelve el número de operaciones MikroTik pendientes para este gateway."""
    from app.services.mikrotik.sync_queue import get_pending_count
    from app.models.mikrotik_sync_queue import MikroTikSyncQueue
    r = db.get(Gateway, gateway_id)
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")
    items = (
        db.query(MikroTikSyncQueue)
        .filter(MikroTikSyncQueue.gateway_id == gateway_id)
        .filter(MikroTikSyncQueue.status.in_(["pending", "failed", "done"]))
        .order_by(MikroTikSyncQueue.created_at.desc())
        .limit(50)
        .all()
    )
    return {
        "pending_count": get_pending_count(gateway_id, db),
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


@router.delete("/{gateway_id}/pppoe-sessions/{username}", response_model=dict)
def delete_gateway_pppoe_session(gateway_id: uuid.UUID, username: str, db: DBSession, _: AdminOrTechnician) -> dict:
    """
    Desconecta una sesión PPPoE activa (kick) en el router especificado.
    """
    r = db.get(Gateway, gateway_id)
    if not r or not r.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gateway no encontrado")
    
    try:
        success = disconnect_pppoe_session(r, username)
        if success:
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
