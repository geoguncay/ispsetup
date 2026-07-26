"""
Decodificador puro de paquetes NetFlow v9 (RFC 3954), sin I/O.

Solo extrae lo que el colector necesita: direcciones IPv4 origen/destino y
bytes del flow. El resto de los campos de cada template se saltan usando su
longitud declarada, para no desalinear el parseo del resto del registro.
"""
import ipaddress
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

NETFLOW_V9_HEADER_LEN = 20
FLOWSET_HEADER_LEN = 4
TEMPLATE_FLOWSET_ID = 0
OPTIONS_TEMPLATE_FLOWSET_ID = 1
MIN_DATA_FLOWSET_ID = 256

FIELD_IN_BYTES = 1
FIELD_IPV4_SRC_ADDR = 8
FIELD_IPV4_DST_ADDR = 12

# (exporter_ip, source_id, template_id) -> [(field_type, field_length), ...]
TemplateKey = tuple[str, int, int]
TemplateFields = list[tuple[int, int]]


@dataclass
class FlowRecord:
    src_addr: str | None
    dst_addr: str | None
    in_bytes: int


def _read_uint(data: bytes, offset: int, length: int) -> int:
    return int.from_bytes(data[offset:offset + length], byteorder="big", signed=False)


def _read_ipv4(data: bytes, offset: int, length: int) -> str | None:
    if length != 4:
        return None
    return str(ipaddress.IPv4Address(data[offset:offset + length]))


def _parse_template_flowset(
    data: bytes, start: int, end: int, exporter_ip: str, source_id: int,
    templates: dict[TemplateKey, TemplateFields],
) -> None:
    offset = start
    while offset + 4 <= end:
        template_id = _read_uint(data, offset, 2)
        field_count = _read_uint(data, offset + 2, 2)
        offset += 4

        fields: TemplateFields = []
        truncated = False
        for _ in range(field_count):
            if offset + 4 > end:
                truncated = True
                break
            field_type = _read_uint(data, offset, 2)
            field_length = _read_uint(data, offset + 2, 2)
            fields.append((field_type, field_length))
            offset += 4

        if truncated:
            logger.warning("Template NetFlow truncado de %s (source_id=%s)", exporter_ip, source_id)
            break
        if template_id >= MIN_DATA_FLOWSET_ID and fields:
            templates[(exporter_ip, source_id, template_id)] = fields


def _parse_data_flowset(
    data: bytes, start: int, end: int, flowset_id: int, exporter_ip: str, source_id: int,
    templates: dict[TemplateKey, TemplateFields],
) -> list[FlowRecord]:
    fields = templates.get((exporter_ip, source_id, flowset_id))
    if not fields:
        # Template todavía no visto (o perdido) para este flowset: no se puede
        # interpretar el layout del registro, se descarta sin lanzar error.
        return []

    record_size = sum(length for _, length in fields)
    if record_size <= 0:
        return []

    records: list[FlowRecord] = []
    offset = start
    while offset + record_size <= end:
        src_addr: str | None = None
        dst_addr: str | None = None
        in_bytes = 0
        pos = offset
        for field_type, field_length in fields:
            if field_type == FIELD_IPV4_SRC_ADDR:
                src_addr = _read_ipv4(data, pos, field_length)
            elif field_type == FIELD_IPV4_DST_ADDR:
                dst_addr = _read_ipv4(data, pos, field_length)
            elif field_type == FIELD_IN_BYTES:
                in_bytes = _read_uint(data, pos, field_length)
            pos += field_length
        offset += record_size

        if (src_addr or dst_addr) and in_bytes:
            records.append(FlowRecord(src_addr=src_addr, dst_addr=dst_addr, in_bytes=in_bytes))
    return records


def parse_packet(
    data: bytes, exporter_ip: str, templates: dict[TemplateKey, TemplateFields],
) -> list[FlowRecord]:
    """Decodifica un paquete NetFlow v9 completo.

    `templates` se muta in-place a medida que se ven Template FlowSets, para
    que el caller mantenga la caché entre paquetes (y para que un Data
    FlowSet más adelante en este mismo paquete ya pueda resolverse).

    Nunca lanza: ante datos corruptos o inesperados registra un warning y
    devuelve lo que se haya podido extraer hasta ese punto.
    """
    records: list[FlowRecord] = []
    try:
        if len(data) < NETFLOW_V9_HEADER_LEN:
            return records
        version = _read_uint(data, 0, 2)
        if version != 9:
            logger.debug("Paquete NetFlow con versión %s ignorado (solo se soporta v9)", version)
            return records
        source_id = _read_uint(data, 16, 4)

        length = len(data)
        offset = NETFLOW_V9_HEADER_LEN
        while offset + FLOWSET_HEADER_LEN <= length:
            flowset_id = _read_uint(data, offset, 2)
            flowset_length = _read_uint(data, offset + 2, 2)
            if flowset_length < FLOWSET_HEADER_LEN or offset + flowset_length > length:
                logger.warning("FlowSet NetFlow con longitud inválida de %s", exporter_ip)
                break

            body_start = offset + FLOWSET_HEADER_LEN
            body_end = offset + flowset_length

            if flowset_id == TEMPLATE_FLOWSET_ID:
                _parse_template_flowset(data, body_start, body_end, exporter_ip, source_id, templates)
            elif flowset_id == OPTIONS_TEMPLATE_FLOWSET_ID:
                pass  # No se necesita option data; el offset avanza igual abajo.
            elif flowset_id >= MIN_DATA_FLOWSET_ID:
                records.extend(
                    _parse_data_flowset(data, body_start, body_end, flowset_id, exporter_ip, source_id, templates)
                )

            offset += flowset_length
    except Exception:
        logger.warning("Paquete NetFlow v9 malformado de %s", exporter_ip, exc_info=True)

    return records
