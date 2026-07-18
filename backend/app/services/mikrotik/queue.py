"""
Servicio MikroTik para gestionar colas de ancho de banda (Simple Queues).
"""
import logging
from app.models.gateway import Gateway
from app.services.mikrotik.gateway_pool import gateway_pool
from app.services.mikrotik.gateway_resources import get_gateway_resource_config, render_resource_template
from librouteros.query import Key

logger = logging.getLogger(__name__)


def validate_simple_queue_types(api, resources: dict) -> None:
    """Comprueba que los Queue Types elegidos existan antes de guardar la configuración."""
    configured = {
        resources['simple_queue_upload_type'],
        resources['simple_queue_download_type'],
    }
    available = {entry.get('name') for entry in list(api.path('/queue/type'))}
    missing = sorted(name for name in configured if name not in available)
    if missing:
        raise ValueError(
            f"Los Queue Types no existen en RouterOS: {', '.join(missing)}"
        )


def get_clean_parent_name(name: str | None) -> str:
    """
    Normaliza el nombre sin modificar el valor elegido para el gateway.
    """
    if not name:
        return "isp_padre"
    name_clean = name.strip()
    if name_clean.lower() in ("none", ""):
        return "isp_padre"
    return name_clean


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
    resources = get_gateway_resource_config(gateway)['speed_control']

    if gateway.speed_control_type == 'pcq_addresslist':
        from app.services.mikrotik.address_list import get_clean_list_name
        from app.services.mikrotik.gateway_configuration import ensure_pcq_parent_rules

        with gateway_pool.connect_to(gateway) as api:
            ensure_pcq_parent_rules(api, resources['client_address_list'], resources)
        return
    if gateway.speed_control_type == 'dhcp_lease_dynamic':
        try:
            with gateway_pool.connect_to(gateway) as api:
                leases = list(
                    api.path('/ip/dhcp-server/lease').select().where(Key('address') == ip)
                )
                if leases:
                    list(api('/ip/dhcp-server/lease/set', **{
                        '.id': leases[0]['.id'],
                        'rate-limit': max_limit,
                        'comment': render_resource_template(
                            resources['dhcp_comment_template'], client_name=client_name, plan_name=plan_name
                        ),
                    }))
                else:
                    logger.warning(
                        "No existe un DHCP lease para %s en %s; no se puede crear la cola dinámica sin MAC",
                        ip,
                        gateway.name,
                    )
        except Exception as e:
            logger.error(f"Error al actualizar DHCP lease para IP {ip} en {gateway.name}: {e}")
            raise
        return
    if gateway.speed_control_type != 'simple_queues':
        return

    try:
        with gateway_pool.connect_to(gateway) as api:
            structure = resources['simple_queue_structure']
            parent_name = None
            if structure == 'parented':
                parent_name = get_or_create_parent_queue(api, resources['parent_queue'])

            queue_name = render_resource_template(
                resources['client_queue_name_template'], client_name=client_name, plan_name=plan_name, ip=ip
            )

            # Buscar por target IP
            query_target = api.path('/queue/simple').select().where(Key('target') == target_ip)
            existing = list(query_target)

            # Si no se encuentra por IP, intentar por nombre
            if not existing:
                query_name = api.path('/queue/simple').select().where(Key('name') == queue_name)
                existing = list(query_name)

            params = {
                "name": queue_name,
                "target": target_ip,
                "max-limit": max_limit,
                "queue": f"{resources['simple_queue_upload_type']}/{resources['simple_queue_download_type']}",
                "comment": plan_name,
                "disabled": False
            }
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
                update_params = {".id": entry_id, **params}
                if structure == 'standalone':
                    update_params['parent'] = 'none'
                list(api("/queue/simple/set", **update_params))
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
                    "queue_type": q.get("queue"),
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
    resources = get_gateway_resource_config(gateway)['speed_control']
    if resources['simple_queue_structure'] != 'parented':
        raise ValueError('Este gateway utiliza colas simples independientes y no tiene cola padre')
    try:
        with gateway_pool.connect_to(gateway) as api:
            parent_name = get_or_create_parent_queue(
                api, resources['parent_queue']
            )
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
    resources = get_gateway_resource_config(gateway)['speed_control']
    if resources['simple_queue_structure'] != 'parented':
        raise ValueError('Este gateway utiliza colas simples independientes y no tiene cola padre')
    try:
        with gateway_pool.connect_to(gateway) as api:
            # Buscar cola llamada 'isp_padre'
            configured_parent = resources['parent_queue']
            query = api.path('/queue/simple').select().where(Key('name') == configured_parent)
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
    resources = get_gateway_resource_config(gateway)['speed_control']
    if (
        not gateway.speed_control
        or gateway.speed_control_type != 'simple_queues'
        or resources['simple_queue_structure'] != 'parented'
    ):
        return

    # Si parent_queue no está configurada, usar el default isp_padre
    parent_name = resources['parent_queue']
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


def apply_simple_queue_structure(gateway: Gateway, client_ips: list[str]) -> None:
    """Valida Queue Types y aplica padre/independencia a las colas de clientes existentes."""
    if gateway.speed_control_type != 'simple_queues':
        return

    resources = get_gateway_resource_config(gateway)['speed_control']
    managed_targets = {f'{ip}/32' for ip in client_ips}
    try:
        with gateway_pool.connect_to(gateway) as api:
            validate_simple_queue_types(api, resources)
            parent_name = None
            if resources['simple_queue_structure'] == 'parented':
                parent_name = get_or_create_parent_queue(api, resources['parent_queue'])
                if not parent_name or parent_name == 'none':
                    raise ValueError('No se pudo crear o localizar la cola padre')

            queue_value = (
                f"{resources['simple_queue_upload_type']}/"
                f"{resources['simple_queue_download_type']}"
            )
            for entry in list(api.path('/queue/simple')):
                if entry.get('target') not in managed_targets or not entry.get('.id'):
                    continue
                params = {
                    '.id': entry['.id'],
                    'queue': queue_value,
                    'parent': parent_name if parent_name else 'none',
                }
                list(api('/queue/simple/set', **params))
    except Exception as exc:
        logger.error('No se pudo aplicar la estructura de colas en %s: %s', gateway.name, exc)
        raise
