"""
Servicio MikroTik para gestionar perfiles y secretos PPPoE, así como sesiones activas.
"""
import logging
from sqlalchemy.orm import Session
from librouteros.query import Key
from app.models.gateway import Gateway
from app.models.pppoe_profile import PPPoEProfile
from app.models.plan import Plan
from app.services.mikrotik.gateway_pool import gateway_pool

logger = logging.getLogger(__name__)


def parse_rate_limit(rate_limit: str | None) -> tuple[int | None, int | None]:
    """
    Parsea el rate-limit de RouterOS (ej. '5M/10M' o '512k/1024k')
    y devuelve una tupla (speed_down_mbps, speed_up_mbps).
    El formato de rate-limit en MikroTik es rx-rate/tx-rate (Upload/Download).
    """
    if not rate_limit:
        return None, None
    try:
        # Extraer solo la primera parte (descartando burst settings si existen)
        main_part = rate_limit.split(" ")[0]
        if "/" not in main_part:
            return None, None
        
        up_str, down_str = main_part.split("/")
        
        def to_mbps(s: str) -> int:
            s = s.upper().strip()
            if "M" in s:
                return int(s.replace("M", ""))
            elif "K" in s:
                # Convertir kbps a mbps (mínimo 1)
                return max(1, int(float(s.replace("K", "")) / 1024))
            elif "G" in s:
                return int(s.replace("G", "")) * 1024
            else:
                return int(s) // 1000000

        return to_mbps(down_str), to_mbps(up_str)
    except Exception as e:
        logger.warning(f"No se pudo parsear el rate-limit '{rate_limit}': {e}")
        return None, None


def bytes_to_human(n: int | str | None) -> str:
    """Convierte bytes a formato humano legible (MB, GB, etc.)."""
    if n is None:
        return "0 B"
    try:
        val = int(n)
    except ValueError:
        return str(n)
    
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if val < 1024.0:
            return f"{val:.1f} {unit}" if unit != "B" else f"{val} {unit}"
        val /= 1024.0
    return f"{val:.1f} PB"


def sync_pppoe_profile_in_gateway(gateway: Gateway, plan: Plan) -> str:
    """
    Sincroniza el perfil PPPoE del plan en el MikroTik.
    Lo crea si no existe o actualiza su rate-limit.
    Retorna el nombre del perfil creado/actualizado.
    """
    profile_name = plan.name
    
    # Calcular el rate-limit (rx-rate/tx-rate: Upload/Download)
    if plan.speed_up_kbps > 0 and plan.speed_down_kbps > 0:
        rate_limit = f"{plan.speed_up_kbps}k/{plan.speed_down_kbps}k"
    else:
        rate_limit = f"{plan.speed_up_mbps}M/{plan.speed_down_mbps}M"
        
    try:
        with gateway_pool.connect_to(gateway) as api:
            name_key = Key('name')
            query = api.path('/ppp/profile').select().where(name_key == profile_name)
            existing = list(query)
            
            params = {
                "name": profile_name,
                "rate-limit": rate_limit
            }
            
            if existing:
                entry_id = existing[0].get(".id")
                list(api("/ppp/profile/set", **{".id": entry_id, **params}))
                logger.info(f"Perfil PPPoE '{profile_name}' actualizado en gateway {gateway.name}")
            else:
                list(api("/ppp/profile/add", **params))
                logger.info(f"Perfil PPPoE '{profile_name}' creado en gateway {gateway.name}")
                
            return profile_name
    except Exception as e:
        logger.error(f"Error al sincronizar perfil PPPoE '{profile_name}' en {gateway.name}: {e}")
        raise e


def sync_pppoe_profiles_from_gateway(db: Session, gateway: Gateway) -> int:
    """
    Sincroniza todos los planes locales como perfiles PPPoE en el MikroTik
    y actualiza la tabla local de PPPoEProfile.
    """
    try:
        plans = db.query(Plan).all()
        synced_count = 0
        active_names = []
        
        for plan in plans:
            # Sincronizar en MikroTik
            profile_name = sync_pppoe_profile_in_gateway(gateway, plan)
            active_names.append(profile_name)
            
            # Buscar o crear perfil en BD
            profile = db.query(PPPoEProfile).filter(
                PPPoEProfile.gateway_id == gateway.id,
                PPPoEProfile.name == profile_name
            ).first()
            
            if profile:
                profile.speed_down_mbps = plan.speed_down_mbps
                profile.speed_up_mbps = plan.speed_up_mbps
            else:
                profile = PPPoEProfile(
                    name=profile_name,
                    speed_down_mbps=plan.speed_down_mbps,
                    speed_up_mbps=plan.speed_up_mbps,
                    gateway_id=gateway.id
                )
                db.add(profile)
            
            synced_count += 1
            
        # Limpiar perfiles locales que ya no corresponden a ningún plan activo
        if active_names:
            db.query(PPPoEProfile).filter(
                PPPoEProfile.gateway_id == gateway.id,
                ~PPPoEProfile.name.in_(active_names)
            ).delete(synchronize_session=False)
            
        db.commit()
        logger.info(f"Sincronizados {synced_count} perfiles PPPoE (basados en planes) para el gateway {gateway.name}")
        return synced_count
    except Exception as e:
        logger.error(f"Error al sincronizar perfiles PPPoE hacia {gateway.name}: {e}")
        raise e


def sync_pppoe_secret_in_gateway(
    gateway: Gateway,
    username: str,
    password: str,
    profile_name: str,
    client_name: str,
    disabled: bool = False
) -> None:
    """
    Sincroniza un secreto PPPoE en el MikroTik.
    Lo crea si no existe, o actualiza sus propiedades (contraseña, perfil, comentario, estado activo).
    """
    try:
        with gateway_pool.connect_to(gateway) as api:
            name_key = Key('name')
            query = api.path('/ppp/secret').select().where(name_key == username)
            existing = list(query)
            
            params = {
                "name": username,
                "password": password,
                "profile": profile_name,
                "comment": client_name,
                "service": "pppoe",
                "disabled": disabled
            }
            
            if existing:
                entry_id = existing[0].get(".id")
                list(api("/ppp/secret/set", **{".id": entry_id, **params}))
                logger.info(f"Secreto PPPoE '{username}' actualizado en gateway {gateway.name}")
            else:
                list(api("/ppp/secret/add", **params))
                logger.info(f"Secreto PPPoE '{username}' creado en gateway {gateway.name}")
                
    except Exception as e:
        logger.error(f"Error al sincronizar secreto PPPoE {username} en {gateway.name}: {e}")
        raise e


def remove_pppoe_secret_from_gateway(gateway: Gateway, username: str) -> None:
    """
    Elimina un secreto PPPoE del MikroTik si existe.
    """
    try:
        with gateway_pool.connect_to(gateway) as api:
            name_key = Key('name')
            query = api.path('/ppp/secret').select().where(name_key == username)
            existing = list(query)
            
            for entry in existing:
                entry_id = entry.get(".id")
                list(api("/ppp/secret/remove", **{".id": entry_id}))
                logger.info(f"Secreto PPPoE '{username}' eliminado del gateway {gateway.name}")
                
    except Exception as e:
        logger.error(f"Error al eliminar secreto PPPoE {username} en {gateway.name}: {e}")
        raise e


def fetch_active_pppoe_sessions(gateway: Gateway) -> list[dict]:
    """
    Obtiene la lista de sesiones PPPoE activas en tiempo real desde el MikroTik.
    """
    try:
        with gateway_pool.connect_to(gateway) as api:
            active_list = list(api.path('/ppp/active'))
            
            formatted_sessions = []
            for entry in active_list:
                tx = entry.get("bytes-out", 0)
                rx = entry.get("bytes-in", 0)
                
                formatted_sessions.append({
                    "id": entry.get(".id"),
                    "username": entry.get("name"),
                    "ip_address": entry.get("address"),
                    "uptime": entry.get("uptime"),
                    "caller_id": entry.get("caller-id"),
                    "bytes_tx": tx,
                    "bytes_rx": rx,
                    "bytes_tx_human": bytes_to_human(tx),
                    "bytes_rx_human": bytes_to_human(rx),
                })
            return formatted_sessions
    except Exception as e:
        logger.error(f"Error al obtener sesiones PPPoE activas en {gateway.name}: {e}")
        raise e


def disconnect_pppoe_session(gateway: Gateway, username: str) -> bool:
    """
    Desconecta una sesión activa de un usuario en el MikroTik (lo expulsa de /ppp/active).
    """
    try:
        with gateway_pool.connect_to(gateway) as api:
            name_key = Key('name')
            query = api.path('/ppp/active').select().where(name_key == username)
            existing = list(query)
            
            if not existing:
                logger.info(f"No se encontró sesión activa para {username} en {gateway.name}")
                return False
                
            for entry in existing:
                entry_id = entry.get(".id")
                list(api("/ppp/active/remove", **{".id": entry_id}))
                logger.info(f"Sesión activa del usuario '{username}' desconectada en {gateway.name}")
            return True
    except Exception as e:
        logger.error(f"Error al desconectar sesión activa de {username} en {gateway.name}: {e}")
        raise e
