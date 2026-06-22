"""
Endpoints CRUD de routers MikroTik.
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminOnly, AdminOrTecnico, CurrentUser, DBSession
from app.core.security import decrypt_secret, encrypt_secret
from app.models.router import Router
from app.models.client import Client
from app.models.site import Site
from app.models.static_ip import StaticIP
from app.models.pppoe_profile import PPPoEProfile
from app.schemas.pppoe import PPPoEProfileRead, PPPoESessionActive
from app.services.mikrotik.pppoe import (
    sync_pppoe_profiles_from_router,
    fetch_active_pppoe_sessions,
    disconnect_pppoe_session,
)
from app.services.mikrotik.address_list import fetch_clients_from_address_list
from app.services.mikrotik.queue import fetch_queues, get_parent_queue_limit, update_parent_queue_limit
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
    data["site_id"] = r.site_id
    data["site_nombre"] = r.site_nombre
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
    # 1. Determinar y sanear nombres de cola padre y address list
    nombre_limpio = payload.nombre.strip().lower().replace(" ", "_")
    import re
    nombre_limpio = re.sub(r'[^a-z0-9_-]', '', nombre_limpio)
    
    cola_padre_name = payload.cola_padre
    if not cola_padre_name:
        cola_padre_name = f"isp_padre_{nombre_limpio}"
    elif not cola_padre_name.startswith("isp_"):
        cola_padre_name = f"isp_{cola_padre_name}"

    address_list_name = payload.address_list
    if not address_list_name:
        address_list_name = f"isp_clientes_{nombre_limpio}"
    elif not address_list_name.startswith("isp_"):
        address_list_name = f"isp_{address_list_name}"

    # Manejar creación o asignación de Sitio
    site_id = payload.site_id
    if payload.new_site_nombre and payload.new_site_nombre.strip():
        new_site_name = payload.new_site_nombre.strip()
        existing_site = db.query(Site).filter(Site.nombre == new_site_name).first()
        if existing_site:
            site_id = existing_site.id
        else:
            new_site = Site(nombre=new_site_name)
            db.add(new_site)
            db.flush()
            site_id = new_site.id

    r = Router(
        nombre=payload.nombre,
        ip=payload.ip,
        puerto_api=payload.puerto_api,
        usuario_api=payload.usuario_api,
        password_enc=encrypt_secret(payload.password_api),
        activo=payload.activo,
        modelo_hw=payload.modelo_hw,
        notas=payload.notas,
        latitud=payload.latitud,
        longitud=payload.longitud,
        monitoreo_trafico=payload.monitoreo_trafico,
        control_velocidad=payload.control_velocidad,
        sincronizar_logs=payload.sincronizar_logs,
        notificaciones_alertas=payload.notificaciones_alertas,
        cola_padre=cola_padre_name,
        address_list=address_list_name,
        ancho_banda_up=payload.ancho_banda_up or 0,
        ancho_banda_down=payload.ancho_banda_down or 0,
        site_id=site_id,
    )
    db.add(r)
    db.commit()
    db.refresh(r)

    # 2. Sincronizar cola padre en MikroTik si está activo
    if r.control_velocidad:
        from app.services.mikrotik.queue import sync_router_parent_queue
        try:
            sync_router_parent_queue(r)
        except Exception as e:
            # Registrar error pero no cancelar la creación en base de datos
            import logging
            logging.getLogger(__name__).error(f"No se pudo crear cola padre en MikroTik para el router: {e}")
            pass

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

    # Guardar el nombre anterior de la cola padre antes de actualizar
    old_cola_padre = r.cola_padre

    update_data = payload.model_dump(exclude_unset=True)
    if "password_api" in update_data:
        update_data["password_enc"] = encrypt_secret(update_data.pop("password_api"))

    # Manejar creación o asignación de Sitio
    if "new_site_nombre" in update_data and update_data["new_site_nombre"] and update_data["new_site_nombre"].strip():
        new_site_name = update_data.pop("new_site_nombre").strip()
        existing_site = db.query(Site).filter(Site.nombre == new_site_name).first()
        if existing_site:
            r.site_id = existing_site.id
        else:
            new_site = Site(nombre=new_site_name)
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
    if "nombre" in update_data and (not r.cola_padre or not r.address_list):
        nombre_limpio = r.nombre.strip().lower().replace(" ", "_")
        import re
        nombre_limpio = re.sub(r'[^a-z0-9_-]', '', nombre_limpio)
        if not r.cola_padre:
            r.cola_padre = f"isp_padre_{nombre_limpio}"
        if not r.address_list:
            r.address_list = f"isp_clientes_{nombre_limpio}"

    if "cola_padre" in update_data and r.cola_padre:
        if not r.cola_padre.startswith("isp_"):
            r.cola_padre = f"isp_{r.cola_padre}"

    if "address_list" in update_data and r.address_list:
        if not r.address_list.startswith("isp_"):
            r.address_list = f"isp_{r.address_list}"

    db.commit()
    db.refresh(r)

    # Sincronizar cola padre en MikroTik si el control de velocidad está activo
    if r.control_velocidad:
        from app.services.mikrotik.queue import sync_router_parent_queue
        try:
            sync_router_parent_queue(r, old_parent_name=old_cola_padre)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"No se pudo actualizar la cola padre en MikroTik para el router: {e}")
            pass

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


@router.get("/{router_id}/address-lists", response_model=list[str])
def get_router_address_lists(router_id: uuid.UUID, db: DBSession, _: AdminOrTecnico) -> list[str]:
    """
    Obtiene los nombres de todas las address-lists del router.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
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
    _: AdminOnly,
    list_name: str = "clientes"
) -> dict:
    """
    Importa clientes de una address-list de MikroTik especificada a la base de datos,
    y los agrega a la lista 'clientes' del router como clientes nuevos.
    Genera cédulas ecuatorianas válidas de forma determinista para cumplir con el esquema.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

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
            StaticIP.router_id == router_id,
            StaticIP.ip == ip
        ).first()

        if exists_ip:
            continue

        name = comment if comment else f"Importado IP {ip}"
        cedula = generate_dummy_cedula(existing_imported_count + imported_count)

        # Crear Cliente
        client = Client(
            nombre=name,
            cedula=cedula,
            telefono="0999999999",
            direccion="Importado desde MikroTik",
            router_id=router_id,
            tipo="static",
            activo=True,
        )
        db.add(client)
        db.flush()

        # Crear StaticIP
        static_ip = StaticIP(
            cliente_id=client.id,
            ip=ip,
            router_id=router_id,
            notas=f"Importado automáticamente desde lista '{list_name}'"
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
    return {"status": "success", "imported_count": imported_count}


@router.get("/{router_id}/queues", response_model=list[dict])
def get_router_queues(router_id: uuid.UUID, db: DBSession, _: AdminOrTecnico) -> list[dict]:
    """
    Obtiene la lista de colas del router, enriqueciéndolas con el cliente_id,
    nombre de cliente y plan_activo de la base de datos basándose en el target IP.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
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
        .join(StaticIP, Client.id == StaticIP.cliente_id)
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
                "nombre": active_plan.plan.nombre if active_plan and active_plan.plan else "Sin plan"
            }
            client_map[client.static_ip.ip] = {
                "id": client.id,
                "nombre": client.nombre,
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
            "cliente_id": client_info["id"] if client_info else None,
            "cliente_nombre": client_info["nombre"] if client_info else None,
            "plan_activo": client_info["plan"] if client_info else None,
        }
        enriched_queues.append(q_data)

    return enriched_queues


@router.get("/{router_id}/parent-queue", response_model=dict)
def get_parent_queue(router_id: uuid.UUID, db: DBSession, _: AdminOrTecnico) -> dict:
    """
    Obtiene el límite de velocidad actual de la cola simple padre ('PADRE' o 'total').
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

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
    _: AdminOnly
) -> dict:
    """
    Establece los límites de velocidad de subida/bajada de la cola simple padre en MikroTik.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")

    try:
        update_parent_queue_limit(r, limit_up_mbps, limit_down_mbps)
        return {"status": "success", "message": f"Cola padre configurada a {limit_up_mbps}M/{limit_down_mbps}M"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al aplicar cambios en el router: {str(e)}"
        )


@router.post("/{router_id}/sync-pppoe-profiles", response_model=dict)
def sync_router_pppoe_profiles(router_id: uuid.UUID, db: DBSession, _: AdminOnly) -> dict:
    """
    Sincroniza perfiles PPPoE desde el router MikroTik y los guarda en la base de datos.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    
    try:
        count = sync_pppoe_profiles_from_router(db, r)
        return {"status": "success", "message": f"Sincronizados {count} perfiles PPPoE exitosamente."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al conectar con el router MikroTik: {str(e)}"
        )


@router.get("/{router_id}/pppoe-profiles", response_model=list[PPPoEProfileRead])
def get_router_pppoe_profiles(router_id: uuid.UUID, db: DBSession, _: AdminOrTecnico) -> list:
    """
    Devuelve los perfiles PPPoE guardados en la BD para el router especificado.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    
    return db.query(PPPoEProfile).filter(PPPoEProfile.router_id == router_id).order_by(PPPoEProfile.nombre).all()


@router.get("/{router_id}/pppoe-sessions", response_model=list[PPPoESessionActive])
def get_router_pppoe_sessions(router_id: uuid.UUID, db: DBSession, _: AdminOrTecnico) -> list:
    """
    Obtiene la lista de sesiones PPPoE activas en tiempo real desde el router.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    
    try:
        return fetch_active_pppoe_sessions(r)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al obtener sesiones activas desde el router MikroTik: {str(e)}"
        )


@router.delete("/{router_id}/pppoe-sessions/{username}", response_model=dict)
def delete_router_pppoe_session(router_id: uuid.UUID, username: str, db: DBSession, _: AdminOrTecnico) -> dict:
    """
    Desconecta una sesión PPPoE activa (kick) en el router especificado.
    """
    r = db.get(Router, router_id)
    if not r or not r.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Router no encontrado")
    
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
