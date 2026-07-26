"""
Colector NetFlow v9 para el modo de Gateway "Traffic Flow".

Proceso standalone (no tarea Celery): mantiene un socket UDP abierto,
decodifica los paquetes con `app.services.netflow.parser` y alimenta
`traffic_samples` / el canal Redis `gateway_traffic:{gateway_id}` con el
mismo formato que ya produce `app.workers.traffic.poll_traffic`, para que
los endpoints de historial y el WebSocket en vivo (`app/api/traffic_api.py`)
sigan funcionando sin cambios.

Solo procesa paquetes de Gateways activos con `traffic_accounting ==
'traffic_flow'`, identificados por la IP origen del paquete UDP contra
`Gateway.ip` — la misma convención que ya usa FreeRADIUS para asociar
Accounting-Requests a un Gateway (ver docs/radius.md).
"""
import asyncio
import json
import logging
import signal
import uuid
from datetime import datetime, timezone

from app.core import database
from app.core.config import settings
from app.models.client import Client
from app.models.gateway import Gateway
from app.models.static_ip import StaticIP
from app.models.traffic_sample import TrafficSample
from app.services.netflow.parser import TemplateFields, TemplateKey, parse_packet
from app.workers.traffic import ensure_partition_exists

logger = logging.getLogger(__name__)

GatewayMap = dict[str, uuid.UUID]  # gateway.ip -> gateway_id
ClientMap = dict[tuple[uuid.UUID, str], uuid.UUID]  # (gateway_id, client_ip) -> client_id
ClientNames = dict[uuid.UUID, str]  # client_id -> nombre para mostrar


def load_mappings() -> tuple[GatewayMap, ClientMap, ClientNames]:
    """Carga desde Postgres los Gateways en modo Traffic Flow y sus clientes
    con IP estática activa. Se re-ejecuta periódicamente; nunca lanza."""
    db = database.SessionLocal()
    try:
        gateways = (
            db.query(Gateway.id, Gateway.ip)
            .filter(Gateway.active == True, Gateway.traffic_accounting == "traffic_flow")
            .all()
        )
        gateway_map: GatewayMap = {ip: gateway_id for gateway_id, ip in gateways}

        client_map: ClientMap = {}
        client_names: ClientNames = {}
        gateway_ids = list(gateway_map.values())
        if gateway_ids:
            rows = (
                db.query(StaticIP.gateway_id, StaticIP.ip, StaticIP.client_id, Client.full_name)
                .join(Client, StaticIP.client_id == Client.id)
                .filter(StaticIP.gateway_id.in_(gateway_ids), Client.active == True)
                .all()
            )
            for gateway_id, ip, client_id, full_name in rows:
                client_map[(gateway_id, ip)] = client_id
                client_names[client_id] = full_name

        return gateway_map, client_map, client_names
    except Exception:
        logger.error("No se pudieron cargar los mapeos de Gateways/Clientes para NetFlow", exc_info=True)
        return {}, {}, {}
    finally:
        db.close()


class NetflowCollectorProtocol(asyncio.DatagramProtocol):
    """Recibe los datagramas NetFlow v9 y acumula bytes por (gateway, cliente)
    hasta el próximo flush periódico."""

    def __init__(self) -> None:
        self.templates: dict[TemplateKey, TemplateFields] = {}
        self.gateway_map: GatewayMap = {}
        self.client_map: ClientMap = {}
        self.accumulator: dict[tuple[uuid.UUID, uuid.UUID], dict[str, int]] = {}

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        exporter_ip = addr[0]
        gateway_id = self.gateway_map.get(exporter_ip)
        if gateway_id is None:
            return  # No es (o ya no es) un Gateway activo en modo Traffic Flow.

        for record in parse_packet(data, exporter_ip, self.templates):
            if record.src_addr:
                client_id = self.client_map.get((gateway_id, record.src_addr))
                if client_id:
                    self._accumulate(gateway_id, client_id, tx=record.in_bytes)
            if record.dst_addr:
                client_id = self.client_map.get((gateway_id, record.dst_addr))
                if client_id:
                    self._accumulate(gateway_id, client_id, rx=record.in_bytes)

    def _accumulate(self, gateway_id: uuid.UUID, client_id: uuid.UUID, rx: int = 0, tx: int = 0) -> None:
        bucket = self.accumulator.setdefault((gateway_id, client_id), {"rx": 0, "tx": 0})
        bucket["rx"] += rx
        bucket["tx"] += tx

    def error_received(self, exc: Exception) -> None:
        logger.warning("Error de socket UDP en el colector NetFlow: %s", exc)


async def _mapping_refresh_loop(protocol: NetflowCollectorProtocol, client_names: ClientNames) -> None:
    while True:
        gateway_map, client_map, names = await asyncio.to_thread(load_mappings)
        protocol.gateway_map = gateway_map
        protocol.client_map = client_map
        client_names.clear()
        client_names.update(names)
        await asyncio.sleep(settings.NETFLOW_MAPPING_REFRESH_SECONDS)


async def _flush(protocol: NetflowCollectorProtocol, redis_conn, client_names: ClientNames, interval: int) -> None:
    if not protocol.accumulator:
        return
    snapshot, protocol.accumulator = protocol.accumulator, {}

    now = datetime.now(timezone.utc)
    db = database.SessionLocal()
    try:
        ensure_partition_exists(db, now)

        db_records: list[TrafficSample] = []
        by_gateway: dict[uuid.UUID, list[dict]] = {}

        for (gateway_id, client_id), deltas in snapshot.items():
            rx_delta = max(0, deltas["rx"])
            tx_delta = max(0, deltas["tx"])
            if rx_delta <= 0 and tx_delta <= 0:
                continue

            cache_key = f"netflow:client_bytes:{gateway_id}:{client_id}"
            prev_rx, prev_tx = 0, 0
            prev_raw = await redis_conn.get(cache_key)
            if prev_raw:
                try:
                    prev = json.loads(prev_raw)
                    prev_rx = int(prev.get("rx_bytes", 0))
                    prev_tx = int(prev.get("tx_bytes", 0))
                except (ValueError, TypeError, json.JSONDecodeError):
                    logger.warning("Contador NetFlow corrupto en Redis para %s, reiniciando", cache_key)

            rx_bytes = prev_rx + rx_delta
            tx_bytes = prev_tx + tx_delta
            await redis_conn.setex(cache_key, 86400, json.dumps({"rx_bytes": rx_bytes, "tx_bytes": tx_bytes}))

            rx_rate = int((rx_delta * 8) / interval)
            tx_rate = int((tx_delta * 8) / interval)

            db_records.append(TrafficSample(
                id=uuid.uuid4(),
                gateway_id=gateway_id,
                client_id=client_id,
                rx_bytes=rx_bytes,
                tx_bytes=tx_bytes,
                rx_delta_bytes=rx_delta,
                tx_delta_bytes=tx_delta,
                rx_rate=rx_rate,
                tx_rate=tx_rate,
                timestamp=now,
            ))

            by_gateway.setdefault(gateway_id, []).append({
                "client_id": str(client_id),
                "name": client_names.get(client_id, ""),
                "rx_bytes": rx_bytes,
                "tx_bytes": tx_bytes,
                "rx_delta_bytes": rx_delta,
                "tx_delta_bytes": tx_delta,
                "rx_rate": rx_rate,
                "tx_rate": tx_rate,
            })

        if db_records:
            db.bulk_save_objects(db_records)
            db.commit()
            logger.info("NetFlow: %s muestras de tráfico guardadas.", len(db_records))

        for gateway_id, clients in by_gateway.items():
            payload = {
                "gateway_id": str(gateway_id),
                "timestamp": now.isoformat(),
                "clients": clients,
                "interfaces": [],
            }
            try:
                await redis_conn.publish(f"gateway_traffic:{gateway_id}", json.dumps(payload))
            except Exception:
                logger.error("Error publicando tráfico NetFlow en Redis para gateway %s", gateway_id, exc_info=True)
    except Exception:
        db.rollback()
        logger.error("Error al volcar muestras NetFlow", exc_info=True)
    finally:
        db.close()


async def _flush_loop(protocol: NetflowCollectorProtocol, redis_conn, client_names: ClientNames) -> None:
    interval = settings.NETFLOW_FLUSH_INTERVAL_SECONDS
    while True:
        await asyncio.sleep(interval)
        await _flush(protocol, redis_conn, client_names, interval)


async def run() -> None:
    import redis.asyncio as aioredis

    redis_conn = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    protocol = NetflowCollectorProtocol()
    client_names: ClientNames = {}

    # Cargar los mapeos una vez antes de empezar a recibir, para no descartar
    # los primeros paquetes mientras arranca el refresh loop.
    protocol.gateway_map, protocol.client_map, initial_names = await asyncio.to_thread(load_mappings)
    client_names.update(initial_names)

    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: protocol,
        local_addr=(settings.NETFLOW_COLLECTOR_HOST, settings.TRAFFIC_FLOW_PORT),
    )
    logger.info(
        "Colector NetFlow v9 escuchando en %s:%s",
        settings.NETFLOW_COLLECTOR_HOST, settings.TRAFFIC_FLOW_PORT,
    )

    stop_event = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop_event.set)

    refresh_task = asyncio.create_task(_mapping_refresh_loop(protocol, client_names))
    flush_task = asyncio.create_task(_flush_loop(protocol, redis_conn, client_names))

    try:
        await stop_event.wait()
    finally:
        refresh_task.cancel()
        flush_task.cancel()
        transport.close()
        await redis_conn.aclose()
        logger.info("Colector NetFlow detenido.")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())


if __name__ == "__main__":
    main()
