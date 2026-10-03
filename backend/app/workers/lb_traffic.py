"""
Tarea Celery: monitoreo periódico de interfaces de balanceadores de carga.

Mismo patrón que app.workers.traffic.poll_traffic, pero sin el límite de 20
interfaces (aquí se reportan TODAS) y sin filtrar las caídas/deshabilitadas,
para que la UI pueda mostrar el estado up/down real de cada puerto.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import database
from app.core.redis import LB_INTERFACES_PREFIX, LB_INTERFACES_TTL
from app.models.load_balancer import LoadBalancer
from app.models.load_balancer_interface_sample import LoadBalancerInterfaceSample
from app.services.router.router_pool import router_pool
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

POLL_LB_TIMEOUT_SECONDS = 4.5


def ensure_partition_exists(db: Session, dt: datetime) -> str:
    """Asegura la partición mensual de lb_interface_samples. No-op en SQLite."""
    if db.bind.dialect.name == "sqlite":
        return "lb_interface_samples"

    partition_name = f"lb_interface_samples_y{dt.year}m{dt.month:02d}"
    start_date = f"{dt.year}-{dt.month:02d}-01"
    next_month = dt.month + 1
    next_year = dt.year
    if next_month > 12:
        next_month = 1
        next_year += 1
    end_date = f"{next_year}-{next_month:02d}-01"

    query = f"""
    CREATE TABLE IF NOT EXISTS {partition_name}
    PARTITION OF lb_interface_samples
    FOR VALUES FROM ('{start_date}') TO ('{end_date}');
    """
    try:
        db.execute(text(query))
        db.commit()
        logger.debug(f"Partición de base de datos verificada: {partition_name}")
    except Exception as e:
        db.rollback()
        logger.error(f"Error al crear partición {partition_name}: {e}")
    return partition_name


def sync_poll_load_balancer(lb: LoadBalancer) -> list[dict]:
    """
    Consulta síncrona a un balanceador MikroTik para obtener TODAS sus interfaces.
    Diseñado para ejecutarse concurrentemente en un hilo separado.
    """
    samples: list[dict] = []
    try:
        with router_pool.connect_to(lb) as api:
            iface_list = list(api("/interface/print"))
            for iface in iface_list:
                running = iface.get("running") == "true" or iface.get("running") is True
                disabled = iface.get("disabled") == "true" or iface.get("disabled") is True
                samples.append({
                    "load_balancer_id": lb.id,
                    "interface_name": iface.get("name"),
                    "running": running,
                    "disabled": disabled,
                    "rx_bytes": int(iface.get("rx-byte", 0) or 0),
                    "tx_bytes": int(iface.get("tx-byte", 0) or 0),
                })
    except Exception as e:
        logger.error(f"Fallo de conexión al colectar interfaces en balanceador {lb.name}: {e}")
        return []
    return samples


async def calculate_rates(
    load_balancer_id: uuid.UUID, samples: list[dict], now: datetime, redis_conn
) -> list[dict]:
    """Calcula bps de cada interfaz a partir del delta de bytes y tiempo (igual que traffic.py)."""
    now_ts = now.timestamp()

    for sample in samples:
        cache_key = f"lb:iface_bytes:{load_balancer_id}:{sample['interface_name']}"
        prev_raw = await redis_conn.get(cache_key)
        rx_rate = 0
        tx_rate = 0

        if prev_raw:
            try:
                prev = json.loads(prev_raw)
                time_diff = now_ts - prev["ts"]
                if time_diff > 0.1:
                    diff_rx = sample["rx_bytes"] - prev["rx_bytes"]
                    diff_tx = sample["tx_bytes"] - prev["tx_bytes"]
                    if diff_rx >= 0 and diff_tx >= 0:
                        rx_rate = int((diff_rx * 8) / time_diff)
                        tx_rate = int((diff_tx * 8) / time_diff)
            except Exception as e:
                logger.error(f"Error al calcular velocidad de interfaz {sample['interface_name']}: {e}")

        await redis_conn.setex(cache_key, 60, json.dumps({
            "rx_bytes": sample["rx_bytes"],
            "tx_bytes": sample["tx_bytes"],
            "ts": now_ts,
        }))
        sample["rx_rate"] = rx_rate
        sample["tx_rate"] = tx_rate

    return samples


@celery_app.task(name="app.workers.lb_traffic.poll_lb_interfaces")
def poll_lb_interfaces():
    """
    Tarea Celery periódica ejecutada cada 5 segundos.
    1. Asegura la partición de lb_interface_samples del mes actual.
    2. Sondea TODAS las interfaces de cada balanceador activo, en paralelo.
    3. Calcula tasas bps, guarda las muestras, cachea el snapshot actual en
       Redis (para GET .../interfaces) y lo publica por Pub/Sub (para el
       WebSocket de tráfico en vivo).
    """
    db = database.SessionLocal()
    now = datetime.now(timezone.utc)

    try:
        ensure_partition_exists(db, now)

        load_balancers = db.query(LoadBalancer).filter(LoadBalancer.active == True).all()
        if not load_balancers:
            logger.debug("No hay balanceadores activos para monitorear.")
            return

        async def _run_async_gathering():
            import redis.asyncio as aioredis
            from app.core.config import settings

            local_redis = aioredis.from_url(
                settings.REDIS_URL, encoding="utf-8", decode_responses=True,
            )
            try:
                loop = asyncio.get_running_loop()
                tasks = [
                    asyncio.wait_for(
                        loop.run_in_executor(None, sync_poll_load_balancer, lb),
                        timeout=POLL_LB_TIMEOUT_SECONDS,
                    )
                    for lb in load_balancers
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                db_records = []
                for lb, result in zip(load_balancers, results):
                    if isinstance(result, Exception):
                        if isinstance(result, asyncio.TimeoutError):
                            logger.warning(
                                f"Timeout colectando interfaces en balanceador {lb.name} "
                                f"tras {POLL_LB_TIMEOUT_SECONDS}s"
                            )
                        else:
                            logger.error(f"Error colectando interfaces en balanceador {lb.name}: {result}")
                        continue
                    if not result:
                        continue

                    enriched = await calculate_rates(lb.id, result, now, local_redis)

                    for sample in enriched:
                        db_records.append(LoadBalancerInterfaceSample(
                            id=uuid.uuid4(),
                            load_balancer_id=sample["load_balancer_id"],
                            interface_name=sample["interface_name"],
                            running=sample["running"],
                            disabled=sample["disabled"],
                            rx_bytes=sample["rx_bytes"],
                            tx_bytes=sample["tx_bytes"],
                            rx_rate=sample["rx_rate"],
                            tx_rate=sample["tx_rate"],
                            timestamp=now,
                        ))

                    snapshot = [
                        {
                            "name": s["interface_name"],
                            "running": s["running"],
                            "disabled": s["disabled"],
                            "rx_bytes": s["rx_bytes"],
                            "tx_bytes": s["tx_bytes"],
                            "rx_rate": s["rx_rate"],
                            "tx_rate": s["tx_rate"],
                        }
                        for s in enriched
                    ]

                    try:
                        await local_redis.setex(
                            f"{LB_INTERFACES_PREFIX}{lb.id}", LB_INTERFACES_TTL, json.dumps(snapshot)
                        )
                        await local_redis.publish(
                            f"lb_traffic:{lb.id}",
                            json.dumps({
                                "load_balancer_id": str(lb.id),
                                "timestamp": now.isoformat(),
                                "interfaces": snapshot,
                            }),
                        )
                    except Exception as publish_err:
                        logger.error(f"Error publicando tráfico en Redis para {lb.name}: {publish_err}")

                if db_records:
                    db.bulk_save_objects(db_records)
                    db.commit()
                    logger.info(f"Muestras de interfaces de balanceadores guardadas: {len(db_records)} registros.")
            finally:
                await local_redis.aclose()

        asyncio.run(_run_async_gathering())

    except Exception as e:
        logger.error(f"Error general en poll_lb_interfaces: {e}", exc_info=True)
    finally:
        db.close()
