import uuid
from datetime import datetime
from pydantic import BaseModel


class MonthlyTraffic(BaseModel):
    month: str
    down_gb: float
    up_gb: float


class TrafficResponse(BaseModel):
    client_id: uuid.UUID
    history: list[MonthlyTraffic]


class TrafficDataPoint(BaseModel):
    timestamp: datetime
    rx_rate: float  # bps
    tx_rate: float  # bps
    rx_bytes: int
    tx_bytes: int


class ClientTrafficHistory(BaseModel):
    client_id: uuid.UUID
    range: str
    samples: list[TrafficDataPoint]
