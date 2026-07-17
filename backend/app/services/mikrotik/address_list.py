"""
Servicio MikroTik para gestionar direcciones IP en el firewall address-list.
"""
import logging
from app.models.gateway import Gateway
from app.services.mikrotik.gateway_pool import gateway_pool
from librouteros.query import Key

logger = logging.getLogger(__name__)


def get_suspend_list_name(gateway) -> str:
    """
    Retorna el nombre de la lista de suspendidos configurada en el gateway.
    Fallback: 'isp_suspendidos'.
    """
    name = getattr(gateway, 'suspend_list', None)
    if not name or name.strip().lower() in ('none', ''):
        return 'isp_suspendidos'
    return name.strip()


def get_clean_list_name(name: str | None) -> str:
    """
    Sanea el nombre de una address-list en MikroTik aplicando el prefijo isp_.
    """
    if not name:
        return "isp_clientes"
    name_clean = name.strip()
    if name_clean.lower() in ("none", ""):
        return "isp_clientes"
    if name_clean.startswith("isp_"):
        return name_clean
    return f"isp_clientes_{name_clean}"


def sync_ip_in_address_list(gateway: Gateway, ip: str, client_name: str, list_name: str = "isp_clientes") -> None:
    """
    Sincroniza una IP estática en la lista de firewall especificada de MikroTik.
    Crea la entrada si no existe, o actualiza el comentario si difiere.
    Remueve la IP de otras listas (excepto suspendidos/isp_suspendidos) si cambió de lista.
    """
    if gateway.speed_control_type != 'pcq_addresslist':
        return

    try:
        with gateway_pool.connect_to(gateway) as api:
            list_key = Key('list')
            address_key = Key('address')

            # Buscar y remover la IP de otras listas administradas que no correspondan a list_name
            query_all = api.path('/ip/firewall/address-list').select().where(
                address_key == ip
            )
            suspend_list = get_suspend_list_name(gateway)
            for entry in list(query_all):
                current_list = entry.get("list")
                if current_list not in ("suspendidos", "isp_suspendidos", suspend_list) and current_list != list_name:
                    # Solo limpiar si empieza con "isp_" o es el legado "clientes"
                    if current_list == "clientes" or (current_list and current_list.startswith("isp_")):
                        entry_id = entry.get(".id")
                        list(api("/ip/firewall/address-list/remove", **{".id": entry_id}))
                        logger.info(f"IP {ip} removida de lista antigua '{current_list}' en {gateway.name}")

            query = api.path('/ip/firewall/address-list').select().where(
                list_key == list_name,
                address_key == ip
            )
            existing = list(query)
            if existing:
                entry = existing[0]
                entry_id = entry.get(".id")
                # Si el comentario cambió, actualizarlo
                if entry.get("comment") != client_name:
                    list(api("/ip/firewall/address-list/set", **{".id": entry_id, "comment": client_name}))
                    logger.info(f"Comentario actualizado para IP {ip} en {gateway.name} (lista '{list_name}'): {client_name}")
            else:
                list(api("/ip/firewall/address-list/add", list=list_name, address=ip, comment=client_name))
                logger.info(f"IP {ip} agregada a lista '{list_name}' en {gateway.name}")
    except Exception as e:
        logger.error(f"Error al sincronizar IP {ip} en {gateway.name}: {e}")
        raise e


def remove_ip_from_address_list(gateway: Gateway, ip: str) -> None:
    """
    Remueve una IP de todas las listas de firewall administradas por la plataforma en MikroTik.
    """
    try:
        with gateway_pool.connect_to(gateway) as api:
            address_key = Key('address')
            query = api.path('/ip/firewall/address-list').select().where(
                address_key == ip
            )
            existing = list(query)
            for entry in existing:
                list_name = entry.get("list")
                # Remover si empieza con "isp_" o coincide con los legados "clientes" o "suspendidos"
                if list_name and (list_name.startswith("isp_") or list_name in ("clientes", "suspendidos")):
                    entry_id = entry.get(".id")
                    list(api("/ip/firewall/address-list/remove", **{".id": entry_id}))
                    logger.info(f"IP {ip} removida de lista '{list_name}' en {gateway.name}")
    except Exception as e:
        logger.error(f"Error al remover IP {ip} de las listas en {gateway.name}: {e}")
        raise e


def fetch_clients_from_address_list(gateway: Gateway, list_name: str = "isp_clientes") -> list[dict]:
    """
    Obtiene todas las entradas de la lista especificada en el router.
    Retorna una lista de diccionarios con la estructura:
      [{"ip": "192.168.10.12", "comment": "Nombre Cliente"}]
    """
    try:
        with gateway_pool.connect_to(gateway) as api:
            list_key = Key('list')
            query = api.path('/ip/firewall/address-list').select().where(
                list_key == list_name
            )
            entries = list(query)
            return [
                {
                    "ip": entry.get("address"),
                    "comment": entry.get("comment", ""),
                }
                for entry in entries
                if entry.get("address")
            ]
    except Exception as e:
        logger.error(f"Error al obtener clientes de la lista {list_name} en {gateway.name}: {e}")
        raise e


def suspend_ip_in_firewall(gateway: Gateway, ip: str, client_name: str) -> None:
    """
    Agrega una dirección IP a la lista de suspendidos configurada del gateway.
    Usa gateway.suspend_list si está configurado, de lo contrario 'isp_suspendidos'.
    """
    suspend_list = get_suspend_list_name(gateway)
    try:
        with gateway_pool.connect_to(gateway) as api:
            list_key = Key('list')
            address_key = Key('address')
            query = api.path('/ip/firewall/address-list').select().where(
                list_key == suspend_list,
                address_key == ip
            )
            existing = list(query)
            if existing:
                entry = existing[0]
                entry_id = entry.get(".id")
                if entry.get("comment") != client_name:
                    list(api("/ip/firewall/address-list/set", **{".id": entry_id, "comment": client_name}))
                    logger.info(f"Comentario actualizado para IP suspendida {ip} en {gateway.name}: {client_name}")
            else:
                list(api("/ip/firewall/address-list/add", list=suspend_list, address=ip, comment=client_name))
                logger.info(f"IP {ip} agregada a lista '{suspend_list}' en {gateway.name}")
    except Exception as e:
        logger.error(f"Error al suspender IP {ip} en {gateway.name}: {e}")
        raise e


def unsuspend_ip_in_firewall(gateway: Gateway, ip: str) -> None:
    """
    Remueve una IP de la lista de suspendidos del gateway y de las listas legadas.
    Busca en gateway.suspend_list, 'isp_suspendidos' y 'suspendidos' para cubrir migraciones.
    """
    suspend_list = get_suspend_list_name(gateway)
    try:
        with gateway_pool.connect_to(gateway) as api:
            list_key = Key('list')
            address_key = Key('address')

            lists_to_check = {suspend_list, 'isp_suspendidos', 'suspendidos'}
            existing = []
            for list_name in lists_to_check:
                query = api.path('/ip/firewall/address-list').select().where(
                    list_key == list_name,
                    address_key == ip
                )
                existing.extend(list(query))

            for entry in existing:
                entry_id = entry.get(".id")
                list(api("/ip/firewall/address-list/remove", **{".id": entry_id}))
                logger.info(f"IP {ip} removida de lista '{entry.get('list')}' en {gateway.name}")
    except Exception as e:
        logger.error(f"Error al reactivar (unsuspend) IP {ip} en {gateway.name}: {e}")
        raise e
