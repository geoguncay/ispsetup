"""
Servicio de health check para routers MikroTik.
Consulta estado en tiempo real y cachea resultado en Redis.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.redis import GATEWAY_HEALTH_PREFIX, ROUTER_STATUS_TTL, redis_client
from app.models.gateway import Gateway
from app.schemas.gateway import GatewayStatus
from app.services.mikrotik.gateway_pool import GatewayConnectionError, gateway_pool

logger = logging.getLogger(__name__)


def _check_zerotier_tunnel_sync(node_id: str) -> bool | None:
    """
    Consulta a ZeroTier Central si el nodo vinculado a un Gateway está online.

    Devuelve:
      True  → el nodo reporta a ZeroTier Central (túnel operativo)
      False → el nodo no reporta (túnel caído / equipo apagado / sin enlace)
      None  → no se pudo determinar (integración deshabilitada, sin configurar,
              nodo no presente en la red o error de la API de ZeroTier)

    Abre su propia sesión de BD; es seguro llamarla desde un thread.
    """
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


async def check_gateway_health(gateway: Gateway) -> GatewayStatus:
    """
    Conecta al router, obtiene versión ROS e interfaces, cachea en Redis.
    No lanza excepciones — siempre devuelve un GatewayStatus.

    Si el router no responde y tiene un nodo ZeroTier vinculado, se cruza el
    estado con ZeroTier Central para distinguir "túnel caído" de "RouterOS caído".
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

    # ── Cruce con ZeroTier: túnel caído vs. RouterOS caído ──────────────────
    zerotier_checked = False
    zerotier_online: bool | None = None
    if new_status_val != "online" and gateway.zerotier_node_id:
        zerotier_online = await asyncio.to_thread(
            _check_zerotier_tunnel_sync, gateway.zerotier_node_id
        )
        zerotier_checked = zerotier_online is not None
        if zerotier_online is False:
            new_status_val = "tunnel_down"
            error_msg = (
                "Túnel ZeroTier caído: el nodo no reporta a ZeroTier Central. "
                "RouterOS podría seguir operativo — revisa enlace/energía del sitio. "
                f"(Detalle API: {error_msg})"
            )
        elif zerotier_online is True:
            error_msg = (
                "RouterOS no responde por la API pese a que el túnel ZeroTier está operativo. "
                f"(Detalle API: {error_msg})"
            )

    # ── Detectar cambio de conectividad y registrar en audit log ────────────
    # Se compara el booleano "en línea" (no el string) para que las
    # transiciones offline ↔ tunnel_down no generen ruido en la auditoría.
    old_data = await redis_client.get(cache_key)
    if old_data:
        try:
            old_cached = GatewayStatus.model_validate_json(old_data)
            was_online = old_cached.status == "online"
            is_online = new_status_val == "online"
            if was_online != is_online:
                from app.services.audit_service import AuditAction, log_connectivity_change
                action = AuditAction.GATEWAY_ONLINE if is_online else AuditAction.GATEWAY_OFFLINE
                reason = new_status_val if not is_online else None
                await asyncio.to_thread(
                    log_connectivity_change,
                    str(gateway.id),
                    gateway.name,
                    action,
                    reason,
                )
                logger.info(
                    f"Connectivity change logged: {gateway.name} "
                    f"{old_cached.status} → {new_status_val}"
                )

                # ── Al recuperar conexión, procesar la cola de sync pendiente ──
                if is_online:
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
        zerotier_checked=zerotier_checked,
        zerotier_online=zerotier_online,
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
