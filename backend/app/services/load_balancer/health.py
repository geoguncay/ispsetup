"""
Servicio de health check para balanceadores de carga MikroTik.
Mismo patrón que app.services.router.health, pero sin el fetch de interfaces
(esa parte ya la cubre el sondeo de app.workers.lb_traffic cada 5s).
"""
import asyncio
import logging
from datetime import datetime, timezone

from app.core.redis import LB_HEALTH_PREFIX, LB_STATUS_TTL, redis_client
from app.models.load_balancer import LoadBalancer
from app.schemas.load_balancer import LoadBalancerStatus
from app.services.router.router_pool import RouterConnectionError, router_pool

logger = logging.getLogger(__name__)


def _check_zerotier_tunnel_sync(node_id: str) -> bool | None:
    """Igual que router.health._check_zerotier_tunnel_sync — ver ese módulo para el detalle."""
    from app.core.database import SessionLocal
    from app.models.system_settings import SystemSettings
    from app.services.zerotier.zerotier_service import ZeroTierError, get_member

    with SessionLocal() as db:
        cfg = db.query(SystemSettings).first()
        if not cfg or not cfg.zt_enabled or not cfg.zt_network_id or not cfg.zt_api_token_encrypted:
            return None
        try:
            member = get_member(cfg, node_id)
        except ZeroTierError as exc:
            logger.warning(f"No se pudo consultar el nodo ZeroTier {node_id}: {exc}")
            return None

    if member is None:
        return None
    return member.online


async def check_load_balancer_health(load_balancer: LoadBalancer) -> LoadBalancerStatus:
    """
    Conecta al balanceador, obtiene versión RouterOS y uptime, cachea en Redis.
    No lanza excepciones — siempre devuelve un LoadBalancerStatus.
    """
    now = datetime.now(timezone.utc)
    cache_key = f"{LB_HEALTH_PREFIX}{load_balancer.id}"

    try:
        with router_pool.connect_to(load_balancer) as api:
            sys_resource = list(api("/system/resource/print"))
            ros_version = sys_resource[0].get("version") if sys_resource else None
            uptime = sys_resource[0].get("uptime") if sys_resource else None
        new_status_val = "online"
        error_msg = None
    except RouterConnectionError as e:
        logger.warning(f"Balanceador {load_balancer.name} offline: {e}")
        new_status_val = "offline"
        error_msg = str(e)
        ros_version = None
        uptime = None
    except Exception as e:
        logger.warning(f"Balanceador {load_balancer.name} error inesperado: {e}")
        new_status_val = "offline"
        error_msg = str(e)
        ros_version = None
        uptime = None

    zerotier_checked = False
    zerotier_online: bool | None = None
    if new_status_val != "online" and load_balancer.zerotier_node_id:
        zerotier_online = await asyncio.to_thread(
            _check_zerotier_tunnel_sync, load_balancer.zerotier_node_id
        )
        zerotier_checked = zerotier_online is not None
        if zerotier_online is False:
            new_status_val = "tunnel_down"
            error_msg = (
                "Túnel ZeroTier caído: el nodo no reporta a ZeroTier Central. "
                f"(Detalle API: {error_msg})"
            )
        elif zerotier_online is True:
            error_msg = (
                "RouterOS no responde por la API pese a que el túnel ZeroTier está operativo. "
                f"(Detalle API: {error_msg})"
            )

    status = LoadBalancerStatus(
        load_balancer_id=load_balancer.id,
        status=new_status_val,
        ip=load_balancer.ip,
        uptime=uptime if new_status_val == "online" else None,
        ros_version=ros_version if new_status_val == "online" else None,
        error=error_msg,
        checked_at=now,
        zerotier_checked=zerotier_checked,
        zerotier_online=zerotier_online,
    )

    await redis_client.setex(cache_key, LB_STATUS_TTL, status.model_dump_json())
    return status


async def get_cached_load_balancer_status(load_balancer_id: str) -> LoadBalancerStatus | None:
    """Lee el estado cacheado de Redis. Devuelve None si no hay caché."""
    data = await redis_client.get(f"{LB_HEALTH_PREFIX}{load_balancer_id}")
    if data is None:
        return None
    return LoadBalancerStatus.model_validate_json(data)
