"""
Servicio de health check para routers MikroTik.
Consulta estado en tiempo real y cachea resultado en Redis.
"""
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.redis import GATEWAY_HEALTH_PREFIX, ROUTER_STATUS_TTL, redis_client
from app.models.gateway import Gateway
from app.schemas.gateway import GatewayStatus
from app.services.mikrotik.gateway_pool import GatewayConnectionError, gateway_pool

logger = logging.getLogger(__name__)


async def check_gateway_health(gateway: Gateway) -> GatewayStatus:
    """
    Conecta al router, obtiene versión ROS e interfaces, cachea en Redis.
    No lanza excepciones — siempre devuelve un GatewayStatus.
    """
    now = datetime.now(timezone.utc)
    cache_key = f"{GATEWAY_HEALTH_PREFIX}{gateway.id}"

    try:
        ros_version: str | None = None
        uptime: str | None = None
        interfaces: list[dict[str, Any]] = []

        with gateway_pool.connect_to(gateway) as api:
            sys_resource = list(api("/system/resource/print"))
            if sys_resource:
                resource = sys_resource[0]
                ros_version = resource.get("version")
                uptime = resource.get("uptime")

            iface_list = list(api("/interface/print"))
            interfaces = [
                {
                    "name": iface.get("name"),
                    "type": iface.get("type"),
                    "running": iface.get("running") == "true" or iface.get("running") is True,
                    "disabled": iface.get("disabled") == "true" or iface.get("disabled") is True,
                    "rx_byte": iface.get("rx-byte"),
                    "tx_byte": iface.get("tx-byte"),
                }
                for iface in iface_list[:20]
            ]

        new_status_val = "online"
        error_msg = None

    except GatewayConnectionError as e:
        logger.warning(f"Router {gateway.name} offline: {e}")
        new_status_val = "offline"
        error_msg = str(e)
        ros_version = None
        uptime = None
        interfaces = []

    except Exception as e:
        # Cualquier otro error de librouteros (conexión caída mid-command, etc.)
        logger.warning(f"Router {gateway.name} error inesperado: {e}")
        new_status_val = "offline"
        error_msg = str(e)
        ros_version = None
        uptime = None
        interfaces = []

    # ── Detectar cambio de conectividad y registrar en audit log ────────────
    old_data = await redis_client.get(cache_key)
    if old_data:
        try:
            old_cached = GatewayStatus.model_validate_json(old_data)
            if old_cached.status != new_status_val:
                from app.services.audit_service import AuditAction, log_connectivity_change
                action = AuditAction.GATEWAY_ONLINE if new_status_val == "online" else AuditAction.GATEWAY_OFFLINE
                import asyncio
                await asyncio.to_thread(
                    log_connectivity_change,
                    str(gateway.id),
                    gateway.name,
                    action,
                )
                logger.info(f"Connectivity change logged: {gateway.name} {old_cached.status} → {new_status_val}")

                # ── Al recuperar conexión, procesar la cola de sync pendiente ──
                if new_status_val == "online":
                    await asyncio.to_thread(_process_sync_queue_for_gateway, gateway)

        except Exception as exc:
            logger.error(f"Error al registrar cambio de conectividad para {gateway.name}: {exc}")

    status = GatewayStatus(
        gateway_id=gateway.id,
        status=new_status_val,
        ip=gateway.ip,
        uptime=uptime if new_status_val == "online" else None,
        ros_version=ros_version if new_status_val == "online" else None,
        interfaces=interfaces if new_status_val == "online" else [],
        error=error_msg,
        checked_at=now,
    )

    # Cachear en Redis
    await redis_client.setex(
        cache_key,
        ROUTER_STATUS_TTL,
        status.model_dump_json(),
    )

    return status


async def get_cached_gateway_status(gateway_id: str) -> GatewayStatus | None:
    """Lee el estado cacheado de Redis. Devuelve None si no hay caché."""
    data = await redis_client.get(f"{GATEWAY_HEALTH_PREFIX}{gateway_id}")
    if data is None:
        return None
    return GatewayStatus.model_validate_json(data)


def _process_sync_queue_for_gateway(gateway: Gateway) -> None:
    """
    Lanzado en un thread cuando el gateway pasa de offline → online.
    Abre su propia sesión de BD para no interferir con el contexto async.
    """
    try:
        from app.core.database import SessionLocal
        from app.services.mikrotik.sync_queue import process_pending_queue
        with SessionLocal() as db:
            result = process_pending_queue(gateway, db)
            if result["total"] > 0:
                logger.info(
                    f"[SyncQueue auto] {gateway.name}: "
                    f"{result['processed']} procesados, {result['failed']} fallidos de {result['total']}"
                )
    except Exception as exc:
        logger.error(f"[SyncQueue auto] Error procesando cola para {gateway.name}: {exc}")

