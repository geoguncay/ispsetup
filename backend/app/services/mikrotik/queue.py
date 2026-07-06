"""
Servicio MikroTik para gestionar colas de ancho de banda (Simple Queues).
"""
import logging
from app.models.gateway import Gateway
from app.services.mikrotik.gateway_pool import gateway_pool
from librouteros.query import Key

logger = logging.getLogger(__name__)


def get_clean_parent_name(name: str | None) -> str:
    """
    Sanea el nombre de la cola simple padre en MikroTik aplicando el prefijo isp_.
    """
    if not name:
        return "isp_padre"
    name_clean = name.strip()
    if name_clean.lower() in ("none", ""):
        return "isp_padre"
    if name_clean.startswith("isp_"):
        return name_clean
    return f"isp_padre_{name_clean}"


def get_or_create_parent_queue(api, name: str = "isp_padre") -> str:
    """
    Busca o crea una cola simple padre.
    Si se busca la de defecto (isp_padre), busca también las heredadas (PADRE, total) para retrocompatibilidad.
    Si una cola padre personalizada no existe, se crea dinámicamente en MikroTik.
    """
    try:
        # 1. Si es la cola por defecto, buscar también legadas
        if name == "isp_padre":
            # Buscar 'isp_padre'
            query_isp = api.path('/queue/simple').select().where(Key('name') == 'isp_padre')
            existing_isp = list(query_isp)
            if existing_isp:
                return 'isp_padre'

            # Buscar 'PADRE'
            query_padre = api.path('/queue/simple').select().where(Key('name') == 'PADRE')
            existing = list(query_padre)
            if existing:
                return 'PADRE'

            # Buscar 'total'
            query_total = api.path('/queue/simple').select().where(Key('name') == 'total')
            existing_total = list(query_total)
            if existing_total:
                return 'total'

        else:
            # Buscar por el nombre exacto de la cola padre custom
            query_custom = api.path('/queue/simple').select().where(Key('name') == name)
            existing_custom = list(query_custom)
            if existing_custom:
                return name

        # 2. Si no se encontró, crearla con límite ilimitado (0/0)
        logger.info(f"Cola padre '{name}' no encontrada. Creándola dinámicamente en MikroTik...")
        list(api("/queue/simple/add", name=name, target="0.0.0.0/0", **{"max-limit": "0/0"}))
        return name
    except Exception as e:
        logger.error(f"Error al buscar o crear la cola padre '{name}': {e}")
        return 'none'


def sync_client_queue(
    gateway: Gateway,
    client_name: str,
    ip: str,
    speed_up: int,  # in Kbps
    speed_down: int,  # in Kbps
    plan_name: str,
    limit_at_up: int | None = None,
    limit_at_down: int | None = None,
    burst_threshold_up: int | None = None,
    burst_threshold_down: int | None = None,
    priority: int | None = None,
    parent: str | None = None,
) -> None:
    """
    Sincroniza la cola simple de un cliente en MikroTik.
    Busca por target IP o por nombre del cliente para crearla o actualizarla.
    """
    target_ip = f"{ip}/32"
    max_limit = f"{speed_up}k/{speed_down}k"

    try:
        with gateway_pool.connect_to(gateway) as api:
            # Sanear y resolver la cola padre
            clean_parent = get_clean_parent_name(parent)
            parent_name = get_or_create_parent_queue(api, clean_parent)

            # Buscar por target IP
            query_target = api.path('/queue/simple').select().where(Key('target') == target_ip)
            existing = list(query_target)

            # Si no se encuentra por IP, intentar por nombre
            if not existing:
                query_name = api.path('/queue/simple').select().where(Key('name') == client_name)
                existing = list(query_name)

            params = {
                "name": client_name,
                "target": target_ip,
                "max-limit": max_limit,
                "comment": plan_name,
                "disabled": False
            }
            # Solo añadir el parent si es válido y no es 'none'
            if parent_name and parent_name != 'none':
                params["parent"] = parent_name

            # Parámetros avanzados
            if limit_at_up and limit_at_down:
                params["limit-at"] = f"{limit_at_up}k/{limit_at_down}k"
            else:
                params["limit-at"] = "0/0"

            if burst_threshold_up and burst_threshold_down:
                params["burst-threshold"] = f"{burst_threshold_up}k/{burst_threshold_down}k"
            else:
                params["burst-threshold"] = "0/0"

            if priority:
                params["priority"] = f"{priority}/{priority}"
            else:
                params["priority"] = "8/8"

            if existing:
                entry = existing[0]
                entry_id = entry.get(".id")
                list(api("/queue/simple/set", **{".id": entry_id, **params}))
                logger.info(f"Cola simple actualizada en {gateway.name} para cliente {client_name} (IP: {ip}, Límite: {max_limit})")
            else:
                list(api("/queue/simple/add", **params))
                logger.info(f"Cola simple creada en {gateway.name} para cliente {client_name} (IP: {ip}, Límite: {max_limit})")

    except Exception as e:
        logger.error(f"Error al sincronizar cola simple para IP {ip} en {gateway.name}: {e}")
        raise e


def remove_client_queue(gateway: Gateway, ip: str) -> None:
    """
    Remueve la cola simple de un cliente en MikroTik basándose en su target IP.
    """
    target_ip = f"{ip}/32"
    try:
        with gateway_pool.connect_to(gateway) as api:
            query = api.path('/queue/simple').select().where(Key('target') == target_ip)
            existing = list(query)
            for entry in existing:
                entry_id = entry.get(".id")
                list(api("/queue/simple/remove", **{".id": entry_id}))
                logger.info(f"Cola simple para IP {ip} removida en {gateway.name}")
    except Exception as e:
        logger.error(f"Error al remover cola simple para IP {ip} en {gateway.name}: {e}")
        raise e


def toggle_client_queue(gateway: Gateway, ip: str, disabled: bool) -> None:
    """
    Habilita o desactiva la cola simple de un cliente en MikroTik basándose en su target IP.
    """
    target_ip = f"{ip}/32"
    try:
        with gateway_pool.connect_to(gateway) as api:
            query = api.path('/queue/simple').select().where(Key('target') == target_ip)
            existing = list(query)
            for entry in existing:
                entry_id = entry.get(".id")
                list(api("/queue/simple/set", **{".id": entry_id, "disabled": disabled}))
                logger.info(f"Cola simple para IP {ip} {'deshabilitada' if disabled else 'habilitada'} en {gateway.name}")
    except Exception as e:
        logger.error(f"Error al cambiar estado de cola simple para IP {ip} en {gateway.name}: {e}")
        raise e


def fetch_queues(gateway: Gateway) -> list[dict]:
    """
    Obtiene la lista completa de colas simples del router MikroTik.
    """
    try:
        with gateway_pool.connect_to(gateway) as api:
            queues = list(api.path('/queue/simple'))
            return [
                {
                    "id": q.get(".id"),
                    "name": q.get("name"),
                    "target": q.get("target"),
                    "max_limit": q.get("max-limit"),
                    "rate": q.get("rate", "0/0"),
                    "parent": q.get("parent"),
                    "comment": q.get("comment", ""),
                    "disabled": q.get("disabled") == "true" or q.get("disabled") is True,
                }
                for q in queues
            ]
    except Exception as e:
        logger.error(f"Error al obtener colas del router {gateway.name}: {e}")
        raise e


def update_parent_queue_limit(gateway: Gateway, limit_up_mbps: int, limit_down_mbps: int) -> None:
    """
    Actualiza el límite de la cola simple padre ('isp_padre', 'PADRE' o 'total').
    Si no existe la cola padre, la crea.
    """
    max_limit = f"{limit_up_mbps}M/{limit_down_mbps}M"
    try:
        with gateway_pool.connect_to(gateway) as api:
            parent_name = get_or_create_parent_queue(api, "isp_padre")
            # Buscar la cola padre para obtener su id
            query = api.path('/queue/simple').select().where(Key('name') == parent_name)
            existing = list(query)
            if existing:
                entry_id = existing[0].get(".id")
                list(api("/queue/simple/set", **{".id": entry_id, "max-limit": max_limit}))
                logger.info(f"Límite de cola padre '{parent_name}' actualizado a {max_limit} en {gateway.name}")
            else:
                list(api("/queue/simple/add", name="isp_padre", target="0.0.0.0/0", **{"max-limit": max_limit}))
                logger.info(f"Cola padre 'isp_padre' creada con límite {max_limit} en {gateway.name}")
    except Exception as e:
        logger.error(f"Error al actualizar límite de cola padre en {gateway.name}: {e}")
        raise e


def get_parent_queue_limit(gateway: Gateway) -> dict:
    """
    Obtiene los límites actuales de subida y bajada de la cola simple padre ('isp_padre', 'PADRE' o 'total').
    Retorna un diccionario con limit_up y limit_down en Mbps, o None si no tiene límites o no existe.
    """
    try:
        with gateway_pool.connect_to(gateway) as api:
            # Buscar cola llamada 'isp_padre'
            query = api.path('/queue/simple').select().where(Key('name') == 'isp_padre')
            existing = list(query)
            
            if not existing:
                # Buscar cola llamada 'PADRE'
                query_legacy = api.path('/queue/simple').select().where(Key('name') == 'PADRE')
                existing = list(query_legacy)
                
            if not existing:
                # Buscar cola llamada 'total'
                query_total = api.path('/queue/simple').select().where(Key('name') == 'total')
                existing = list(query_total)
            
            if existing:
                max_limit = existing[0].get("max-limit", "0/0")
                try:
                    up, down = max_limit.split('/')
                    
                    def parse_mbps(val_str: str) -> int:
                        val_str = val_str.upper().strip()
                        if 'M' in val_str:
                            return int(val_str.replace('M', ''))
                        elif 'K' in val_str:
                            return int(float(val_str.replace('K', '')) / 1000)
                        elif val_str.isdigit():
                            val = int(val_str)
                            return int(val / 1000000)
                        return 0
                        
                    return {
                        "name": existing[0].get("name"),
                        "limit_up": parse_mbps(up),
                        "limit_down": parse_mbps(down)
                    }
                except Exception:
                    pass
            return {"name": "isp_padre", "limit_up": 0, "limit_down": 0}
    except Exception as e:
        logger.error(f"Error al obtener límites de cola padre en {gateway.name}: {e}")
        return {"name": "isp_padre", "limit_up": 0, "limit_down": 0}


def sync_gateway_parent_queue(gateway: Gateway, old_parent_name: str | None = None) -> None:
    """
    Crea o actualiza la cola simple padre asociada a este router en MikroTik.
    Soporta el renombrado de la cola si cambia de nombre para evitar duplicar recursos.
    """
    if not gateway.speed_control:
        return

    # Si parent_queue no está configurada, usar el default isp_padre
    parent_name = get_clean_parent_name(gateway.parent_queue)
    limit_up = gateway.bandwidth_up or 0
    limit_down = gateway.bandwidth_down or 0
    max_limit = f"{limit_up}M/{limit_down}M" if (limit_up > 0 or limit_down > 0) else "0/0"

    try:
        with gateway_pool.connect_to(gateway) as api:
            # 1. Si cambió el nombre de la cola padre, renombrar la existente
            if old_parent_name:
                clean_old = get_clean_parent_name(old_parent_name)
                if clean_old != parent_name:
                    query_old = api.path('/queue/simple').select().where(Key('name') == clean_old)
                    existing_old = list(query_old)
                    if existing_old:
                        entry_id = existing_old[0].get(".id")
                        list(api("/queue/simple/set", **{".id": entry_id, "name": parent_name, "max-limit": max_limit}))
                        logger.info(f"Cola padre del router renombrada de '{clean_old}' a '{parent_name}' en {gateway.name}")
                        return

            # 2. Buscar si ya existe la cola con el nombre nuevo
            query = api.path('/queue/simple').select().where(Key('name') == parent_name)
            existing = list(query)
            if existing:
                entry_id = existing[0].get(".id")
                # Si existe, actualizamos su límite
                list(api("/queue/simple/set", **{".id": entry_id, "max-limit": max_limit}))
                logger.info(f"Cola padre del router '{parent_name}' actualizada con límite {max_limit} en {gateway.name}")
            else:
                # Si no existe, la creamos
                list(api("/queue/simple/add", name=parent_name, target="0.0.0.0/0", **{"max-limit": max_limit}))
                logger.info(f"Cola padre del router '{parent_name}' creada con límite {max_limit} en {gateway.name}")
    except Exception as e:
        logger.error(f"Error al sincronizar cola padre para el router {gateway.name}: {e}")
        raise e


