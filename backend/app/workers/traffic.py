"""
Tarea Celery: colector de tráfico y monitoreo periódico en tiempo real.
"""
import asyncio
import logging
from datetime import datetime, timezone
import json
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import database
from app.models.gateway import Gateway
from app.models.static_ip import StaticIP
from app.models.client import Client
from app.models.traffic_sample import TrafficSample
from app.core.redis import redis_client
from app.workers.celery_app import celery_app
from app.services.mikrotik.gateway_pool import gateway_pool

logger = logging.getLogger(__name__)

POLL_TRAFFIC_GATEWAY_TIMEOUT_SECONDS = 4.5


def ensure_partition_exists(db: Session, dt: datetime) -> str:
    """
    Asegura que exista la partición de PostgreSQL para el mes correspondiente.
    Retorna el nombre de la partición. En SQLite no realiza ninguna acción.
    """
    if db.bind.dialect.name == "sqlite":
        return "traffic_samples"

    partition_name = f"traffic_samples_y{dt.year}m{dt.month:02d}"
    start_date = f"{dt.year}-{dt.month:02d}-01"
    
    # Calcular siguiente mes
    next_month = dt.month + 1
    next_year = dt.year
    if next_month > 12:
        next_month = 1
        next_year += 1
    end_date = f"{next_year}-{next_month:02d}-01"

    query = f"""
    CREATE TABLE IF NOT EXISTS {partition_name} 
    PARTITION OF traffic_samples 
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


def sync_poll_gateway(gateway: Gateway, static_ips_map: dict, now: datetime) -> tuple[list[dict], list[dict]]:
    """
    Consulta síncrona a un router MikroTik para obtener Simple Queues e Interfaces.
    Diseñado para ejecutarse concurridamente en un hilo separado.
    """
    client_samples = []
    interface_samples = []

    try:
        with gateway_pool.connect_to(gateway) as api:
            # 1. Obtener Simple Queues (Tráfico de Clientes)
            try:
                queues = list(api.path('/queue/simple'))
                for q in queues:
                    name = q.get("name")
                    target = q.get("target")  # e.g., "192.168.10.15/32"
                    rate_str = q.get("rate", "0/0")  # e.g., "128000/256000"
                    bytes_str = q.get("bytes", "0/0")  # e.g., "12345/67890"
                    disabled = q.get("disabled") == "true" or q.get("disabled") is True

                    if not target or disabled:
                        continue

                    # Extraer dirección IP (ej: de "192.168.10.15/32" -> "192.168.10.15")
                    ip = target.split('/')[0]
                    client_id = static_ips_map.get((gateway.id, ip))

                    if not client_id:
                        continue

                    # Parsear tasas (Simple Queues en MikroTik reporta: upload/download)
                    try:
                        tx_rate, rx_rate = map(int, rate_str.split('/'))
                    except ValueError:
                        tx_rate, rx_rate = 0, 0

                    try:
                        tx_bytes, rx_bytes = map(int, bytes_str.split('/'))
                    except ValueError:
                        tx_bytes, rx_bytes = 0, 0

                    client_samples.append({
                        "gateway_id": gateway.id,
                        "client_id": client_id,
                        "name": name,
                        "rx_bytes": rx_bytes,
                        "tx_bytes": tx_bytes,
                        "rx_rate": rx_rate,
                        "tx_rate": tx_rate,
                        "timestamp": now,
                    })
            except Exception as eq:
                logger.error(f"Error al consultar colas en {gateway.name}: {eq}")

            # 2. Obtener Interfaces (Consumo Global)
            try:
                iface_list = list(api("/interface/print"))
                for iface in iface_list[:20]:  # Máximo 20 interfaces para optimizar
                    name = iface.get("name")
                    running = iface.get("running") == "true" or iface.get("running") is True or iface.get("running") is None
                    disabled = iface.get("disabled") == "true" or iface.get("disabled") is True
                    rx_bytes = int(iface.get("rx-byte", 0) or 0)
                    tx_bytes = int(iface.get("tx-byte", 0) or 0)

                    if disabled or not running:
                        continue

                    interface_samples.append({
                        "gateway_id": gateway.id,
                        "interface_name": name,
                        "rx_bytes": rx_bytes,
                        "tx_bytes": tx_bytes,
                        "timestamp": now,
                    })
            except Exception as ei:
                logger.error(f"Error al consultar interfaces en {gateway.name}: {ei}")

    except Exception as e:
        logger.error(f"Fallo de conexión al colectar tráfico en router {gateway.name}: {e}")
        return [], []

    return client_samples, interface_samples


async def calculate_interface_rates(gateway_id: uuid.UUID, interface_samples: list[dict], now: datetime, redis_conn) -> list[dict]:
    """
    Calcula la tasa actual en bps para las interfaces basándose en el delta de bytes y tiempo.
    """
    enriched_samples = []
    now_ts = now.timestamp()

    for sample in interface_samples:
        iface_name = sample["interface_name"]
        cache_key = f"gateway:iface_bytes:{gateway_id}:{iface_name}"

        # Obtener muestra anterior de Redis
        prev_data_str = await redis_conn.get(cache_key)
        
        rx_rate = 0
        tx_rate = 0

        if prev_data_str:
            try:
                prev_data = json.loads(prev_data_str)
                prev_rx = prev_data["rx_bytes"]
                prev_tx = prev_data["tx_bytes"]
                prev_ts = prev_data["ts"]

                time_diff = now_ts - prev_ts
                if time_diff > 0.1:
                    diff_rx = sample["rx_bytes"] - prev_rx
                    diff_tx = sample["tx_bytes"] - prev_tx

                    # Evitar valores negativos si el contador de la interfaz se reinició
                    if diff_rx >= 0 and diff_tx >= 0:
                        # Convertir a bits por segundo (bps)
                        rx_rate = int((diff_rx * 8) / time_diff)
                        tx_rate = int((diff_tx * 8) / time_diff)
            except Exception as e:
                logger.error(f"Error al calcular velocidad de interfaz {iface_name}: {e}")

        # Guardar muestra actual para la siguiente ejecución
        current_data = {
            "rx_bytes": sample["rx_bytes"],
            "tx_bytes": sample["tx_bytes"],
            "ts": now_ts
        }
        await redis_conn.setex(cache_key, 60, json.dumps(current_data))

        sample["rx_rate"] = rx_rate
        sample["tx_rate"] = tx_rate
        enriched_samples.append(sample)

    return enriched_samples


@celery_app.task(name="app.workers.traffic.poll_traffic")
def poll_traffic():
    """
    Tarea Celery periódica ejecutada cada 5 segundos.
    1. Asegura la partición de la base de datos para el mes actual.
    2. Recolecta tráfico en paralelo de todos los routers activos.
    3. Registra las muestras en la base de datos (PostgreSQL particionado).
    4. Publica las métricas en tiempo real a Redis Pub/Sub.
    """
    db = database.SessionLocal()
    now = datetime.now(timezone.utc)

    try:
        # Asegurar partición de este mes
        ensure_partition_exists(db, now)

        # Cargar routers activos
        gateways = db.query(Gateway).filter(Gateway.active == True).all()
        if not gateways:
            logger.debug("No hay routers activos para monitorear.")
            return

        logger.info(f"poll_traffic: iniciando recolección para {len(gateways)} routers activos")

        # Cargar mapa de IPs estáticas de clientes activos para relacionar muestras
        # Filtramos clientes activos que tengan IP estática
        static_ips = (
            db.query(StaticIP.gateway_id, StaticIP.ip, StaticIP.client_id)
            .join(Client, StaticIP.client_id == Client.id)
            .filter(Client.active == True)
            .all()
        )
        static_ips_map = {
            (gateway_id, ip): client_id
            for gateway_id, ip, client_id in static_ips
        }

        # Ejecutar recolección en paralelo usando subprocesos/hilos
        async def _run_async_gathering():
            import redis.asyncio as aioredis
            from app.core.config import settings

            local_redis = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
            )

            try:
                loop = asyncio.get_running_loop()
                tasks = []
                for r in gateways:
                    # Correr en un hilo separado de forma no bloqueante
                    task = asyncio.wait_for(
                        loop.run_in_executor(None, sync_poll_gateway, r, static_ips_map, now),
                        timeout=POLL_TRAFFIC_GATEWAY_TIMEOUT_SECONDS,
                    )
                    tasks.append(task)

                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                db_records = []
                published_clients = 0
                published_interfaces = 0
                
                for r, result in zip(gateways, results):
                    if isinstance(result, Exception):
                        if isinstance(result, asyncio.TimeoutError):
                            logger.warning(
                                f"Timeout colectando tráfico en router {r.name} tras {POLL_TRAFFIC_GATEWAY_TIMEOUT_SECONDS}s"
                            )
                        else:
                            logger.error(f"Error colectando tráfico en router {r.name}: {result}")
                        continue

                    client_samples, interface_samples = result
                    published_clients += len(client_samples)

                    # Enriquecer interfaces con tasas bps calculadas
                    enriched_ifaces = await calculate_interface_rates(r.id, interface_samples, now, local_redis)
                    published_interfaces += len(enriched_ifaces)

                    # Guardar en base de datos
                    for cs in client_samples:
                        db_records.append(TrafficSample(
                            id=uuid.uuid4(),
                            gateway_id=cs["gateway_id"],
                            client_id=cs["client_id"],
                            rx_bytes=cs["rx_bytes"],
                            tx_bytes=cs["tx_bytes"],
                            rx_rate=cs["rx_rate"],
                            tx_rate=cs["tx_rate"],
                            timestamp=now,
                        ))

                    for ifs in enriched_ifaces:
                        db_records.append(TrafficSample(
                            id=uuid.uuid4(),
                            gateway_id=ifs["gateway_id"],
                            interface_name=ifs["interface_name"],
                            rx_bytes=ifs["rx_bytes"],
                            tx_bytes=ifs["tx_bytes"],
                            rx_rate=ifs["rx_rate"],
                            tx_rate=ifs["tx_rate"],
                            timestamp=now,
                        ))

                    # Publicar actualización en vivo a Redis Pub/Sub por router
                    pub_payload = {
                        "gateway_id": str(r.id),
                        "timestamp": now.isoformat(),
                        "clients": [
                            {
                                "client_id": str(cs["client_id"]),
                                "name": cs["name"],
                                "rx_bytes": cs["rx_bytes"],
                                "tx_bytes": cs["tx_bytes"],
                                "rx_rate": cs["rx_rate"],
                                "tx_rate": cs["tx_rate"],
                            }
                            for cs in client_samples
                        ],
                        "interfaces": [
                            {
                                "name": ifs["interface_name"],
                                "rx_bytes": ifs["rx_bytes"],
                                "tx_bytes": ifs["tx_bytes"],
                                "rx_rate": ifs["rx_rate"],
                                "tx_rate": ifs["tx_rate"],
                            }
                            for ifs in enriched_ifaces
                        ],
                    }

                    try:
                        await local_redis.publish(
                            f"gateway_traffic:{r.id}",
                            json.dumps(pub_payload)
                        )
                    except Exception as publish_err:
                        logger.error(f"Error publicando tráfico en Redis para {r.name}: {publish_err}")

                # Insertar todas las muestras recolectadas de una sola vez
                if db_records:
                    db.bulk_save_objects(db_records)
                    db.commit()
                    logger.info(f"Muestras de tráfico guardadas: {len(db_records)} registros.")

                logger.info(
                    f"poll_traffic: publicado tick con {published_clients} muestras de clientes y {published_interfaces} de interfaces"
                )
            finally:
                await local_redis.aclose()

        # Correr el ciclo asíncrono
        asyncio.run(_run_async_gathering())

    except Exception as e:
        logger.error(f"Error general en poll_traffic: {e}", exc_info=True)
    finally:
        db.close()
