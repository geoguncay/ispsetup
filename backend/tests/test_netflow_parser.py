"""
Tests del decodificador puro de NetFlow v9 (app.services.netflow.parser).

Los paquetes se arman a mano con struct.pack, replicando el layout real:
header (20 bytes) + FlowSets (Template y/o Data).
"""
import struct

from app.services.netflow.parser import parse_packet

EXPORTER_IP = "10.0.0.1"
SOURCE_ID = 1
TEMPLATE_ID = 256

# (field_type, field_length): IPV4_SRC_ADDR(8,4), IPV4_DST_ADDR(12,4), IN_BYTES(1,4)
TEMPLATE_FIELDS = [(8, 4), (12, 4), (1, 4)]


def _header(count: int, source_id: int = SOURCE_ID) -> bytes:
    return struct.pack(">HHIIII", 9, count, 0, 0, 1, source_id)


def _template_flowset(template_id: int, fields: list[tuple[int, int]]) -> bytes:
    body = struct.pack(">HH", template_id, len(fields))
    for field_type, field_length in fields:
        body += struct.pack(">HH", field_type, field_length)
    return struct.pack(">HH", 0, len(body) + 4) + body


def _ipv4_bytes(ip: str) -> bytes:
    return bytes(int(part) for part in ip.split("."))


def _data_record(src_ip: str, dst_ip: str, in_bytes: int) -> bytes:
    return _ipv4_bytes(src_ip) + _ipv4_bytes(dst_ip) + struct.pack(">I", in_bytes)


def _data_flowset(template_id: int, records: bytes) -> bytes:
    return struct.pack(">HH", template_id, len(records) + 4) + records


def test_parses_template_and_data_in_same_packet():
    records = _data_record("192.168.1.10", "8.8.8.8", 5000) + _data_record("8.8.8.8", "192.168.1.10", 9000)
    packet = (
        _header(count=4)
        + _template_flowset(TEMPLATE_ID, TEMPLATE_FIELDS)
        + _data_flowset(TEMPLATE_ID, records)
    )
    templates: dict = {}

    flows = parse_packet(packet, EXPORTER_IP, templates)

    assert (EXPORTER_IP, SOURCE_ID, TEMPLATE_ID) in templates
    assert len(flows) == 2
    assert flows[0].src_addr == "192.168.1.10"
    assert flows[0].dst_addr == "8.8.8.8"
    assert flows[0].in_bytes == 5000
    assert flows[1].src_addr == "8.8.8.8"
    assert flows[1].dst_addr == "192.168.1.10"
    assert flows[1].in_bytes == 9000


def test_data_flowset_reuses_template_from_previous_packet():
    templates: dict = {}
    template_packet = _header(count=1) + _template_flowset(TEMPLATE_ID, TEMPLATE_FIELDS)
    assert parse_packet(template_packet, EXPORTER_IP, templates) == []
    assert (EXPORTER_IP, SOURCE_ID, TEMPLATE_ID) in templates

    record = _data_record("192.168.1.20", "1.1.1.1", 1234)
    data_packet = _header(count=1) + _data_flowset(TEMPLATE_ID, record)

    flows = parse_packet(data_packet, EXPORTER_IP, templates)

    assert len(flows) == 1
    assert flows[0].src_addr == "192.168.1.20"
    assert flows[0].in_bytes == 1234


def test_data_flowset_with_unknown_template_is_dropped_silently():
    templates: dict = {}
    record = _data_record("192.168.1.20", "1.1.1.1", 1234)
    packet = _header(count=1) + _data_flowset(TEMPLATE_ID, record)

    flows = parse_packet(packet, EXPORTER_IP, templates)

    assert flows == []


def test_zero_byte_flow_is_filtered_out():
    templates: dict = {}
    record = _data_record("192.168.1.20", "1.1.1.1", 0)
    packet = (
        _header(count=2)
        + _template_flowset(TEMPLATE_ID, TEMPLATE_FIELDS)
        + _data_flowset(TEMPLATE_ID, record)
    )

    flows = parse_packet(packet, EXPORTER_IP, templates)

    assert flows == []


def test_truncated_packet_below_header_length_returns_empty():
    templates: dict = {}
    assert parse_packet(b"\x00" * 5, EXPORTER_IP, templates) == []


def test_unsupported_version_is_ignored():
    templates: dict = {}
    packet = struct.pack(">HHIIII", 5, 0, 0, 0, 1, SOURCE_ID)  # NetFlow v5, no soportado
    assert parse_packet(packet, EXPORTER_IP, templates) == []


def test_flowset_with_invalid_length_stops_without_raising():
    templates: dict = {}
    # flowset_id=0, length=2 (menor al mínimo de 4 bytes de header) -> corte defensivo
    packet = _header(count=1) + struct.pack(">HH", 0, 2)
    assert parse_packet(packet, EXPORTER_IP, templates) == []


def test_garbage_bytes_do_not_raise():
    templates: dict = {}
    packet = _header(count=1) + b"\xff" * 40
    # No debe lanzar excepción; el contenido es basura así que puede devolver
    # una lista vacía o parcial, pero nunca debe tumbar el proceso.
    parse_packet(packet, EXPORTER_IP, templates)
