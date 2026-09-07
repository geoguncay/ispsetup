"""
Servicio de cola de sincronización MikroTik.

Cuando MikroTik está desconectado durante la creación de un cliente, las operaciones
de sincronización (address-list, queue, PPPoE secret/profile) se encolan aquí.
Al restaurarse la conexión se procesan automáticamente o bajo demanda.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.router_sync_queue import RouterSyncQueue
from app.models.router import Router

logger = logging.getLogger(__name__)

# Backoff exponencial: intentos 1-5 → 5m, 15m, 1h, 4h, 24h
_BACKOFF_MINUTES = [5, 15, 60, 240, 1440]
MAX_ATTEMPTS = len(_BACKOFF_MINUTES)


def enqueue_sync(
    db: Session,
    router_id,
    client_id,
    operation: str,
    payload: dict,
) -> RouterSyncQueue:
    """Agrega una operación pendiente a la cola. No hace commit — el caller debe hacerlo."""
    item = RouterSyncQueue(
        router_id=router_id,
        client_id=client_id,
        operation=operation,
        payload=payload,
        status="pending",
    )
    db.add(item)
    return item


def process_pending_queue(router: Router, db: Session) -> dict:
    """
    Procesa todos los items pending/failed para un router.
    Retorna un resumen con processed, failed, total.
    """
    now = datetime.now(timezone.utc)

    items = (
        db.query(RouterSyncQueue)
        .filter(
            RouterSyncQueue.router_id == router.id,
            RouterSyncQueue.status.in_(["pending", "failed"]),
            RouterSyncQueue.attempts < MAX_ATTEMPTS,
        )
        .filter(
            (RouterSyncQueue.next_retry_at == None)
            | (RouterSyncQueue.next_retry_at <= now)
        )
        .order_by(RouterSyncQueue.created_at)
        .all()
    )

    processed = 0
    failed = 0

    for item in items:
        try:
            _dispatch(router, item, db)
            item.status = "done"
            item.last_error = None
            db.commit()
            processed += 1
            logger.info(f"[SyncQueue] {item.operation} completado (client_id={item.client_id})")
        except Exception as e:
            item.attempts += 1
            item.status = "failed"
            item.last_error = str(e)[:500]
            delay = _BACKOFF_MINUTES[min(item.attempts - 1, len(_BACKOFF_MINUTES) - 1)]
            item.next_retry_at = now + timedelta(minutes=delay)
            db.commit()
            logger.warning(
                f"[SyncQueue] {item.operation} falló (intento {item.attempts}, "
                f"retry en {delay}m): {e}"
            )
            failed += 1

    return {"processed": processed, "failed": failed, "total": len(items)}


def get_pending_count(router_id, db: Session) -> int:
    """Cantidad de operaciones pendientes/fallidas para un router."""
    return (
        db.query(RouterSyncQueue)
        .filter(
            RouterSyncQueue.router_id == router_id,
            RouterSyncQueue.status.in_(["pending", "failed"]),
            RouterSyncQueue.attempts < MAX_ATTEMPTS,
        )
        .count()
    )


def _dispatch(router: Router, item: RouterSyncQueue, db: Session) -> None:
    """Ejecuta la operación de sync según el tipo almacenado en el item."""
    from app.services.router.address_list import sync_ip_in_address_list
    from app.services.router.queue import sync_client_queue
    from app.services.router.pppoe import sync_pppoe_secret_in_router, sync_pppoe_profile_in_router

    p = item.payload
    op = item.operation

    if op == "add_to_address_list":
        sync_ip_in_address_list(
            router,
            p["ip"],
            p["client_name"],
            list_name=p.get("list_name", "isp_clientes"),
        )

    elif op == "add_queue":
        sync_client_queue(
            router=router,
            client_name=p["client_name"],
            ip=p["ip"],
            speed_up=p["speed_up"],
            speed_down=p["speed_down"],
            plan_name=p["plan_name"],
            limit_at_up=p.get("limit_at_up"),
            limit_at_down=p.get("limit_at_down"),
            burst_threshold_up=p.get("burst_threshold_up"),
            burst_threshold_down=p.get("burst_threshold_down"),
            priority=p.get("priority"),
            parent=p.get("parent"),
        )

    elif op == "add_pppoe_profile":
        from app.models.plan import Plan
        plan = db.get(Plan, p["plan_id"])
        if plan:
            sync_pppoe_profile_in_router(router, plan)

    elif op == "add_pppoe_secret":
        from app.models.pppoe_secret import PPPoESecret
        from app.core.security import decrypt_secret
        secret = db.get(PPPoESecret, p["pppoe_secret_id"])
        if secret:
            # Asegurar perfil antes del secreto (idempotente)
            from app.models.plan import Plan
            from app.models.pppoe_profile import PPPoEProfile
            profile = db.get(PPPoEProfile, secret.profile_id) if secret.profile_id else None
            if profile:
                try:
                    sync_pppoe_profile_in_router(router, db.query(Plan).filter_by(name=profile.name).first())
                except Exception:
                    pass  # Si falla el perfil, intentamos el secreto igualmente
            sync_pppoe_secret_in_router(
                router=router,
                username=secret.ppp_username,
                password=decrypt_secret(secret.ppp_password),
                profile_name=p["profile_name"],
                client_name=p["client_name"],
                disabled=p.get("disabled", False),
            )

    else:
        raise ValueError(f"Operación desconocida en cola de sync: {op!r}")
