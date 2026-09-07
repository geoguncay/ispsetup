import asyncio
import json
import struct
import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import database as db_module
from app.core.database import Base
from app.models.client import Client
from app.models.router import Router
from app.models.static_ip import StaticIP
from app.models.traffic_sample import TrafficSample
from app.services.netflow.collector import NetflowCollectorProtocol, _flush, load_mappings

engine_test = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test)


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setattr(db_module, "engine", engine_test)
    monkeypatch.setattr(db_module, "SessionLocal", TestingSessionLocal)
    Base.metadata.create_all(bind=engine_test)
    yield
    Base.metadata.drop_all(bind=engine_test)


def _ipv4_bytes(ip: str) -> bytes:
    return bytes(int(part) for part in ip.split("."))


def _netflow_packet(records: list[tuple[str, str, int]]) -> bytes:
    """Arma un paquete NetFlow v9 sintético: header + template + data flowset,
    igual que en test_netflow_parser.py."""
    header = struct.pack(">HHIIII", 9, 0, 0, 0, 1, 1)
    fields = [(8, 4), (12, 4), (1, 4)]  # IPV4_SRC_ADDR, IPV4_DST_ADDR, IN_BYTES
    template_body = struct.pack(">HH", 256, len(fields))
    for field_type, field_length in fields:
        template_body += struct.pack(">HH", field_type, field_length)
    template_flowset = struct.pack(">HH", 0, len(template_body) + 4) + template_body

    data_body = b"".join(
        _ipv4_bytes(src) + _ipv4_bytes(dst) + struct.pack(">I", in_bytes)
        for src, dst, in_bytes in records
    )
    data_flowset = struct.pack(">HH", 256, len(data_body) + 4) + data_body
    return header + template_flowset + data_flowset


def _make_router_and_client(db, *, router_ip: str, traffic_accounting: str, client_active: bool = True) -> tuple[Router, Client]:
    gw = Router(
        name=f"GW {router_ip}",
        ip=router_ip,
        api_port=8728,
        api_username="admin",
        password_enc="enc_pass",
        active=True,
        traffic_accounting=traffic_accounting,
    )
    db.add(gw)
    db.flush()
    client = Client(
        full_name="Cliente Prueba",
        cedula=str(uuid.uuid4().int)[:10],
        phone="0999999999",
        address="Quito",
        router_id=gw.id,
        access_method="static",
        active=client_active,
    )
    db.add(client)
    db.flush()
    return gw, client


def test_protocol_accumulates_flow_bytes_for_known_router_and_clients():
    router_id = uuid.uuid4()
    client_id = uuid.uuid4()
    protocol = NetflowCollectorProtocol()
    protocol.router_map = {"10.0.0.9": router_id}
    protocol.client_map = {(router_id, "192.168.30.5"): client_id}

    packet = _netflow_packet([
        ("192.168.30.5", "8.8.8.8", 7000),   # cliente sube (tx)
        ("8.8.8.8", "192.168.30.5", 15000),  # cliente baja (rx)
    ])
    protocol.datagram_received(packet, ("10.0.0.9", 2055))

    assert protocol.accumulator[(router_id, client_id)] == {"rx": 15000, "tx": 7000}


def test_protocol_ignores_packets_from_unknown_exporter():
    protocol = NetflowCollectorProtocol()
    protocol.router_map = {}
    packet = _netflow_packet([("1.2.3.4", "5.6.7.8", 100)])

    protocol.datagram_received(packet, ("9.9.9.9", 2055))

    assert protocol.accumulator == {}


def test_load_mappings_only_includes_traffic_flow_mikrotiks_and_active_clients():
    db = TestingSessionLocal()
    gw_flow, active_client = _make_router_and_client(
        db, router_ip="10.0.0.10", traffic_accounting="traffic_flow", client_active=True
    )
    _, inactive_client = _make_router_and_client(
        db, router_ip="10.0.0.99", traffic_accounting="traffic_flow", client_active=False
    )
    gw_other, _ = _make_router_and_client(
        db, router_ip="10.0.0.11", traffic_accounting="queue_accounting", client_active=True
    )
    db.add(StaticIP(client_id=active_client.id, ip="192.168.40.1", router_id=gw_flow.id))
    db.add(StaticIP(client_id=inactive_client.id, ip="192.168.40.2", router_id=gw_flow.id))
    gw_flow_id, active_client_id = gw_flow.id, active_client.id
    gw_other_ip = gw_other.ip
    db.commit()
    db.close()

    router_map, client_map, client_names = load_mappings()

    assert router_map.get("10.0.0.10") == gw_flow_id
    assert gw_other_ip not in router_map
    assert client_map.get((gw_flow_id, "192.168.40.1")) == active_client_id
    assert (gw_flow_id, "192.168.40.2") not in client_map
    assert client_names.get(active_client_id) == "Cliente Prueba"


def test_flush_writes_traffic_sample_and_publishes():
    db = TestingSessionLocal()
    gw, c = _make_router_and_client(db, router_ip="10.0.0.20", traffic_accounting="traffic_flow")
    router_id, client_id = gw.id, c.id
    db.commit()
    db.close()

    protocol = NetflowCollectorProtocol()
    protocol.accumulator[(router_id, client_id)] = {"rx": 8000, "tx": 4000}

    redis_mock = AsyncMock()
    redis_mock.get = AsyncMock(return_value=None)
    redis_mock.setex = AsyncMock(return_value=True)
    redis_mock.publish = AsyncMock(return_value=True)
    client_names = {client_id: "Cliente Prueba"}

    asyncio.run(_flush(protocol, redis_mock, client_names, interval=5))

    assert protocol.accumulator == {}

    db = TestingSessionLocal()
    sample = db.query(TrafficSample).filter(TrafficSample.client_id == client_id).first()
    assert sample is not None
    assert sample.rx_bytes == 8000
    assert sample.tx_bytes == 4000
    assert sample.rx_delta_bytes == 8000
    assert sample.tx_delta_bytes == 4000
    assert sample.rx_rate == int(8000 * 8 / 5)
    assert sample.tx_rate == int(4000 * 8 / 5)
    db.close()

    redis_mock.setex.assert_awaited_once()
    assert redis_mock.setex.call_args[0][0] == f"netflow:client_bytes:{router_id}:{client_id}"

    redis_mock.publish.assert_awaited_once()
    channel, raw_payload = redis_mock.publish.call_args[0]
    payload = json.loads(raw_payload)
    assert channel == f"router_traffic:{router_id}"
    assert payload["clients"] == [{
        "client_id": str(client_id),
        "name": "Cliente Prueba",
        "rx_bytes": 8000,
        "tx_bytes": 4000,
        "rx_delta_bytes": 8000,
        "tx_delta_bytes": 4000,
        "rx_rate": int(8000 * 8 / 5),
        "tx_rate": int(4000 * 8 / 5),
    }]
    assert payload["interfaces"] == []


def test_flush_accumulates_cumulative_bytes_across_windows():
    db = TestingSessionLocal()
    gw, c = _make_router_and_client(db, router_ip="10.0.0.21", traffic_accounting="traffic_flow")
    router_id, client_id = gw.id, c.id
    db.commit()
    db.close()

    protocol = NetflowCollectorProtocol()
    client_names = {client_id: "Cliente Prueba"}
    redis_mock = AsyncMock()
    redis_mock.setex = AsyncMock(return_value=True)
    redis_mock.publish = AsyncMock(return_value=True)

    redis_mock.get = AsyncMock(return_value=None)
    protocol.accumulator[(router_id, client_id)] = {"rx": 1000, "tx": 500}
    asyncio.run(_flush(protocol, redis_mock, client_names, interval=5))
    stored_json = redis_mock.setex.call_args[0][2]

    redis_mock.get = AsyncMock(return_value=stored_json)
    protocol.accumulator[(router_id, client_id)] = {"rx": 300, "tx": 200}
    asyncio.run(_flush(protocol, redis_mock, client_names, interval=5))

    db = TestingSessionLocal()
    samples = db.query(TrafficSample).filter(
        TrafficSample.client_id == client_id
    ).order_by(TrafficSample.timestamp).all()
    db.close()

    assert len(samples) == 2
    assert samples[0].rx_bytes == 1000
    assert samples[0].rx_delta_bytes == 1000
    assert samples[1].rx_bytes == 1300
    assert samples[1].rx_delta_bytes == 300
    assert samples[1].tx_bytes == 700
    assert samples[1].tx_delta_bytes == 200


def test_flush_does_nothing_when_accumulator_empty():
    protocol = NetflowCollectorProtocol()
    redis_mock = AsyncMock()

    asyncio.run(_flush(protocol, redis_mock, {}, interval=5))

    redis_mock.get.assert_not_called()
    redis_mock.setex.assert_not_called()
    redis_mock.publish.assert_not_called()
