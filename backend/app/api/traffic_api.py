"""
Endpoints API y WebSocket: monitoreo de tráfico en tiempo real e historial.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import func, and_, text
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.deps import get_db, AdminOrTechnician, DBSession
from app.core.security import decode_token
from app.core.redis import redis_client
from app.models.client import Client
from app.models.traffic_sample import TrafficSample
from app.models.user import User
from app.schemas.traffic import ClientTrafficHistory, TrafficDataPoint

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/traffic", tags=["traffic"])


@router.websocket("/ws/{gateway_id}")
async def websocket_traffic_endpoint(
    websocket: WebSocket,
    gateway_id: uuid.UUID,
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
        logger.warning(f"Fallo de autenticación en WebSocket para router {gateway_id}: {auth_err}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Suscribir al canal Pub/Sub del router en Redis
    channel_name = f"gateway_traffic:{gateway_id}"
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
        logger.debug(f"Conexión WebSocket cerrada por el cliente para router: {gateway_id}")
    except Exception as e:
        logger.error(f"Error en WebSocket de tráfico para router {gateway_id}: {e}")
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
    range: str = Query("1h", pattern="^(1h|24h|7d|30d)$"),
):
    """
    Obtiene el histórico de tráfico agregado de un cliente.
    Aplica downsampling para evitar enviar demasiados puntos al frontend.
    """
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    now = datetime.now(timezone.utc)
    if range == "1h":
        start_time = now - timedelta(hours=1)
    elif range == "24h":
        start_time = now - timedelta(hours=24)
    elif range == "7d":
        start_time = now - timedelta(days=7)
    else:  # 30d
        start_time = now - timedelta(days=30)

    # Construir expresión de agrupación según el motor de base de datos
    if db.bind.dialect.name == "sqlite":
        # Dialecto SQLite para pruebas unitarias
        if range == "1h":
            # Agrupar por minuto
            group_expr = func.strftime("%Y-%m-%d %H:%M:00", TrafficSample.timestamp)
        elif range == "24h":
            # Agrupar por minuto para pruebas rápidas
            group_expr = func.strftime("%Y-%m-%d %H:%M:00", TrafficSample.timestamp)
        elif range == "7d":
            # Agrupar por hora
            group_expr = func.strftime("%Y-%m-%d %H:00:00", TrafficSample.timestamp)
        else:
            # Agrupar por hora
            group_expr = func.strftime("%Y-%m-%d %H:00:00", TrafficSample.timestamp)
    else:
        # Dialecto PostgreSQL para desarrollo y producción
        if range == "1h":
            group_expr = func.date_trunc("minute", TrafficSample.timestamp)
        elif range == "24h":
            group_expr = func.date_bin(
                text("interval '5 minutes'"), 
                TrafficSample.timestamp, 
                text("timestamp '2000-01-01'")
            )
        elif range == "7d":
            group_expr = func.date_trunc("hour", TrafficSample.timestamp)
        else:  # 30d
            group_expr = func.date_bin(
                text("interval '4 hours'"), 
                TrafficSample.timestamp, 
                text("timestamp '2000-01-01'")
            )

    # Consulta agregada
    query = (
        db.query(
            group_expr.label("interval_time"),
            func.avg(TrafficSample.rx_rate).label("rx_rate"),
            func.avg(TrafficSample.tx_rate).label("tx_rate"),
            func.max(TrafficSample.rx_bytes).label("rx_bytes"),
            func.max(TrafficSample.tx_bytes).label("tx_bytes"),
        )
        .filter(
            TrafficSample.client_id == client_id,
            TrafficSample.timestamp >= start_time
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
            rx_bytes=int(row.rx_bytes or 0),
            tx_bytes=int(row.tx_bytes or 0),
        ))

    return ClientTrafficHistory(
        client_id=client_id,
        range=range,
        samples=samples
    )


@router.get("/gateway/{gateway_id}", response_model=list[TrafficDataPoint])
def get_gateway_traffic_history(
    gateway_id: uuid.UUID,
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
            TrafficSample.gateway_id == gateway_id,
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
