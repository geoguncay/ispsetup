"""
Endpoints API y WebSocket: monitoreo de tráfico en tiempo real e historial.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import func, and_, text
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.deps import get_db, AdminOrTechnician, DBSession
from app.core.security import decode_token
from app.core.redis import redis_client
from app.models.client import Client
from app.models.traffic_sample import TrafficSample
from app.models.system_settings import SystemSettings
from app.models.user import User
from app.schemas.traffic import (
    ClientTrafficHistory,
    TrafficDataPoint,
    TrafficGap,
    TrafficVolumePoint,
    TrafficVolumeTotals,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/traffic", tags=["traffic"])

TRAFFIC_GAP_THRESHOLD = timedelta(seconds=15)


def _find_client_traffic_gaps(
    db: Session,
    client_id: uuid.UUID,
    start_time: datetime,
    end_time: datetime,
    now: datetime,
) -> list[TrafficGap]:
    """Encuentra intervalos sin muestras sin confundirlos con tráfico igual a cero."""
    observed_end = min(end_time, now)
    if observed_end <= start_time:
        return []

    base_filter = (
        TrafficSample.client_id == client_id,
        TrafficSample.timestamp >= start_time,
        TrafficSample.timestamp < observed_end,
    )
    first_sample, last_sample = db.query(
        func.min(TrafficSample.timestamp),
        func.max(TrafficSample.timestamp),
    ).filter(*base_filter).one()

    if first_sample is None:
        return [TrafficGap(start=start_time, end=observed_end)]

    if first_sample.tzinfo is None:
        first_sample = first_sample.replace(tzinfo=timezone.utc)
    if last_sample.tzinfo is None:
        last_sample = last_sample.replace(tzinfo=timezone.utc)

    gaps: list[TrafficGap] = []
    if first_sample - start_time > TRAFFIC_GAP_THRESHOLD:
        gaps.append(TrafficGap(start=start_time, end=first_sample))

    if db.bind.dialect.name == "sqlite":
        timestamps = [
            row[0] for row in (
                db.query(TrafficSample.timestamp)
                .filter(*base_filter)
                .order_by(TrafficSample.timestamp)
                .all()
            )
        ]
        for previous, current in zip(timestamps, timestamps[1:]):
            previous = previous if previous.tzinfo else previous.replace(tzinfo=timezone.utc)
            current = current if current.tzinfo else current.replace(tzinfo=timezone.utc)
            if current - previous > TRAFFIC_GAP_THRESHOLD:
                gaps.append(TrafficGap(start=previous, end=current))
    else:
        ordered_samples = (
            db.query(
                TrafficSample.timestamp.label("current_timestamp"),
                func.lag(TrafficSample.timestamp)
                .over(order_by=TrafficSample.timestamp)
                .label("previous_timestamp"),
            )
            .filter(*base_filter)
            .subquery()
        )
        internal_gaps = (
            db.query(
                ordered_samples.c.previous_timestamp,
                ordered_samples.c.current_timestamp,
            )
            .filter(
                ordered_samples.c.previous_timestamp.is_not(None),
                ordered_samples.c.current_timestamp
                - ordered_samples.c.previous_timestamp
                > TRAFFIC_GAP_THRESHOLD,
            )
            .all()
        )
        gaps.extend(
            TrafficGap(start=previous, end=current)
            for previous, current in internal_gaps
        )

    if observed_end - last_sample > TRAFFIC_GAP_THRESHOLD:
        gaps.append(TrafficGap(start=last_sample, end=observed_end))

    return gaps


@router.websocket("/ws/{router_id}")
async def websocket_traffic_endpoint(
    websocket: WebSocket,
    router_id: uuid.UUID,
    token: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """
    WebSocket que recibe y retransmite datos de tráfico del router en tiempo real.
    Se conecta al canal Redis Pub/Sub para dicho router.
    """
    await websocket.accept()

    # Validar credenciales JWT manualmente (WebSockets no manejan cabeceras HTTP estándares de Auth)
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        
        user_id_str = payload.get("sub")
        if not user_id_str:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        user_id = uuid.UUID(user_id_str)
        user = db.query(User).filter(User.id == user_id, User.active == True).first()
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if user.role not in ("admin", "technician"):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception as auth_err:
        logger.warning(f"Fallo de autenticación en WebSocket para router {router_id}: {auth_err}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Suscribir al canal Pub/Sub del router en Redis
    channel_name = f"router_traffic:{router_id}"
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(channel_name)

    try:
        # Loop para escuchar y retransmitir mensajes en tiempo real
        async for message in pubsub.listen():
            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                await websocket.send_text(data)
    except WebSocketDisconnect:
        logger.debug(f"Conexión WebSocket cerrada por el cliente para router: {router_id}")
    except Exception as e:
        logger.error(f"Error en WebSocket de tráfico para router {router_id}: {e}")
    finally:
        try:
            await pubsub.unsubscribe(channel_name)
            await pubsub.close()
        except Exception:
            pass


@router.get("/client/{client_id}", response_model=ClientTrafficHistory)
def get_client_traffic_history(
    client_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician,
    range: str = Query("1h", pattern="^(1h|24h|7d|30d|custom)$"),
    period_mode: str = Query("calendar", pattern="^(calendar|rolling)$"),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
):
    """
    Obtiene el volumen transferido por un cliente durante el período.
    Aplica downsampling para evitar enviar demasiados puntos al frontend.
    """
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    now = datetime.now(timezone.utc)
    if range == "custom":
        if start is None or end is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Los parámetros start y end son obligatorios para el rango personalizado",
            )
        start_time = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
        end_time = end if end.tzinfo else end.replace(tzinfo=timezone.utc)
        if start_time >= end_time:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La fecha inicial debe ser anterior a la fecha final",
            )
        if end_time - start_time > timedelta(days=366):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El rango personalizado no puede superar 366 días",
            )
    elif period_mode == "rolling":
        if range == "1h":
            start_time = now - timedelta(hours=1)
        elif range == "24h":
            start_time = now - timedelta(hours=24)
        elif range == "7d":
            start_time = now - timedelta(days=7)
        else:  # 30d
            start_time = now - timedelta(days=30)
        end_time = now
    else:
        localization = db.query(SystemSettings.loc_timezone).first()
        timezone_name = localization[0] if localization and localization[0] else "UTC"
        try:
            local_timezone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError:
            logger.warning("Zona horaria inválida %s; se usará UTC", timezone_name)
            local_timezone = timezone.utc
        local_now = now.astimezone(local_timezone)
        if range == "1h":
            local_start = local_now.replace(minute=0, second=0, microsecond=0)
            local_end = local_start + timedelta(hours=1)
        elif range == "24h":
            local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            local_end = local_start + timedelta(days=1)
        elif range == "7d":
            local_today = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            local_start = local_today - timedelta(days=local_today.weekday())
            local_end = local_start + timedelta(days=7)
        else:  # Mes calendario actual
            local_start = local_now.replace(
                day=1, hour=0, minute=0, second=0, microsecond=0
            )
            if local_start.month == 12:
                local_end = local_start.replace(year=local_start.year + 1, month=1)
            else:
                local_end = local_start.replace(month=local_start.month + 1)
        start_time = local_start.astimezone(timezone.utc)
        end_time = local_end.astimezone(timezone.utc)

    duration = end_time - start_time

    # Construir expresión de agrupación según el motor de base de datos
    if db.bind.dialect.name == "sqlite":
        # Dialecto SQLite para pruebas unitarias
        if duration <= timedelta(days=2):
            # Agrupar por minuto
            group_expr = func.strftime("%Y-%m-%d %H:%M:00", TrafficSample.timestamp)
        else:
            # Agrupar por hora
            group_expr = func.strftime("%Y-%m-%d %H:00:00", TrafficSample.timestamp)
    else:
        # Dialecto PostgreSQL para desarrollo y producción
        if duration <= timedelta(hours=6):
            group_expr = func.date_trunc("minute", TrafficSample.timestamp)
        elif duration <= timedelta(days=2):
            group_expr = func.date_bin(
                text("interval '5 minutes'"), 
                TrafficSample.timestamp, 
                text("timestamp '2000-01-01'")
            )
        elif duration <= timedelta(days=14):
            group_expr = func.date_trunc("hour", TrafficSample.timestamp)
        else:
            group_expr = func.date_bin(
                text("interval '4 hours'"), 
                TrafficSample.timestamp, 
                text("timestamp '2000-01-01'")
            )

    # Consulta agregada
    query = (
        db.query(
            group_expr.label("interval_time"),
            func.sum(TrafficSample.rx_delta_bytes).label("download_bytes"),
            func.sum(TrafficSample.tx_delta_bytes).label("upload_bytes"),
        )
        .filter(
            TrafficSample.client_id == client_id,
            TrafficSample.timestamp >= start_time,
            TrafficSample.timestamp < end_time,
        )
        .group_by(text("interval_time"))
        .order_by(text("interval_time"))
    )

    results = query.all()
    samples = []
    
    for row in results:
        ts = row.interval_time
        if isinstance(ts, str):
            try:
                if len(ts) == 16:
                    ts_dt = datetime.strptime(ts, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
                else:
                    ts_dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            except Exception:
                ts_dt = now
        elif isinstance(ts, datetime):
            ts_dt = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        else:
            ts_dt = now

        download_bytes = int(row.download_bytes or 0)
        upload_bytes = int(row.upload_bytes or 0)
        samples.append(TrafficVolumePoint(
            timestamp=ts_dt,
            download_bytes=download_bytes,
            upload_bytes=upload_bytes,
            total_bytes=download_bytes + upload_bytes,
        ))

    total_download = sum(sample.download_bytes for sample in samples)
    total_upload = sum(sample.upload_bytes for sample in samples)
    gaps = _find_client_traffic_gaps(
        db, client_id, start_time, end_time, now
    )
    return ClientTrafficHistory(
        client_id=client_id,
        range=range,
        period_mode="custom" if range == "custom" else period_mode,
        start=start_time,
        end=end_time,
        totals=TrafficVolumeTotals(
            download_bytes=total_download,
            upload_bytes=total_upload,
            total_bytes=total_download + total_upload,
        ),
        samples=samples,
        gaps=gaps,
    )


@router.get("/router/{router_id}", response_model=list[TrafficDataPoint])
def get_router_traffic_history(
    router_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician,
    range: str = Query("1h", pattern="^(1h|24h|7d|30d)$"),
):
    """
    Obtiene el histórico de tráfico agregado de todos los clientes de un router.
    Aplica downsampling para evitar enviar demasiados puntos al frontend.
    """
    now = datetime.now(timezone.utc)
    if range == "1h":
        start_time = now - timedelta(hours=1)
    elif range == "24h":
        start_time = now - timedelta(hours=24)
    elif range == "7d":
        start_time = now - timedelta(days=7)
    else:  # 30d
        start_time = now - timedelta(days=30)

    # Subconsulta para obtener la suma de rx_rate y tx_rate por cada timestamp
    subquery = (
        db.query(
            TrafficSample.timestamp.label("sample_ts"),
            func.sum(TrafficSample.rx_rate).label("sum_rx"),
            func.sum(TrafficSample.tx_rate).label("sum_tx"),
        )
        .filter(
            TrafficSample.router_id == router_id,
            TrafficSample.client_id.isnot(None),
            TrafficSample.timestamp >= start_time
        )
        .group_by(TrafficSample.timestamp)
        .subquery()
    )

    # Construir expresión de agrupación según el motor de base de datos
    if db.bind.dialect.name == "sqlite":
        if range == "1h":
            group_expr = func.strftime("%Y-%m-%d %H:%M:00", subquery.c.sample_ts)
        elif range == "24h":
            group_expr = func.strftime("%Y-%m-%d %H:%M:00", subquery.c.sample_ts)
        elif range == "7d":
            group_expr = func.strftime("%Y-%m-%d %H:00:00", subquery.c.sample_ts)
        else:
            group_expr = func.strftime("%Y-%m-%d %H:00:00", subquery.c.sample_ts)
    else:
        # Dialecto PostgreSQL
        if range == "1h":
            group_expr = func.date_trunc("minute", subquery.c.sample_ts)
        elif range == "24h":
            group_expr = func.date_bin(
                text("interval '5 minutes'"), 
                subquery.c.sample_ts, 
                text("timestamp '2000-01-01'")
            )
        elif range == "7d":
            group_expr = func.date_trunc("hour", subquery.c.sample_ts)
        else:  # 30d
            group_expr = func.date_bin(
                text("interval '4 hours'"), 
                subquery.c.sample_ts, 
                text("timestamp '2000-01-01'")
            )

    query = (
        db.query(
            group_expr.label("interval_time"),
            func.avg(subquery.c.sum_rx).label("rx_rate"),
            func.avg(subquery.c.sum_tx).label("tx_rate"),
        )
        .group_by(text("interval_time"))
        .order_by(text("interval_time"))
    )

    results = query.all()
    samples = []
    
    for row in results:
        ts = row.interval_time
        if isinstance(ts, str):
            try:
                if len(ts) == 16:
                    ts_dt = datetime.strptime(ts, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
                else:
                    ts_dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            except Exception:
                ts_dt = now
        elif isinstance(ts, datetime):
            ts_dt = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        else:
            ts_dt = now

        samples.append(TrafficDataPoint(
            timestamp=ts_dt,
            rx_rate=float(row.rx_rate or 0),
            tx_rate=float(row.tx_rate or 0),
            rx_bytes=0,
            tx_bytes=0,
        ))

    return samples
