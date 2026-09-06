"""
Cliente para la API de ZeroTier Central (https://api.zerotier.com/api/v1).

Se usa para administrar la red ZeroTier de los Gateways MikroTik y del propio
stack de la plataforma: autorizar nodos, consultar estado y asignar IPs,
todo desde la UI en vez de la consola de my.zerotier.com.
"""
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.security import decrypt_secret
from app.models.system_settings import SystemSettings
from app.schemas.zerotier import ZeroTierMember

ZT_API_BASE = "https://api.zerotier.com/api/v1"
_REQUEST_TIMEOUT = 10.0

# ZeroTier Central no expone un booleano "online" estable en todas las
# versiones de su API; se aproxima comparando lastOnline contra el umbral
# de reporte típico de un cliente ZeroTier activo (~30-60s).
_ONLINE_THRESHOLD_MS = 3 * 60 * 1000


class ZeroTierError(Exception):
    """Error de comunicación o de la API de ZeroTier Central."""


def _request(token: str, method: str, path: str, *, allow_404: bool = False, **kwargs: Any) -> Any:
    url = f"{ZT_API_BASE}{path}"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = httpx.request(method, url, headers=headers, timeout=_REQUEST_TIMEOUT, **kwargs)
    except httpx.RequestError as exc:
        raise ZeroTierError(f"No se pudo conectar con ZeroTier Central: {exc}") from exc

    if response.status_code == 401:
        raise ZeroTierError("Token de API de ZeroTier inválido o expirado")
    if response.status_code == 404:
        if allow_404:
            return None
        raise ZeroTierError("Red o miembro de ZeroTier no encontrado")
    if response.status_code >= 400:
        raise ZeroTierError(f"Error de ZeroTier Central ({response.status_code}): {response.text[:200]}")

    return response.json() if response.content else None


def _token_for(cfg: SystemSettings) -> str:
    if not cfg.zt_api_token_encrypted:
        raise ZeroTierError("No se ha configurado el token de API de ZeroTier")
    return decrypt_secret(cfg.zt_api_token_encrypted)


def _is_online(last_seen_ms: int | None) -> bool:
    if not last_seen_ms:
        return False
    return (time.time() * 1000 - last_seen_ms) < _ONLINE_THRESHOLD_MS


def _format_version(config: dict) -> str | None:
    major = config.get("vMajor")
    minor = config.get("vMinor")
    rev = config.get("vRev")
    if major is None or major < 0:
        return None
    return f"{major}.{minor}.{rev}"


def _to_member_schema(raw: dict) -> ZeroTierMember:
    config = raw.get("config", {}) or {}
    last_seen_ms = raw.get("lastOnline") or raw.get("lastSeen")
    return ZeroTierMember(
        node_id=raw.get("nodeId") or config.get("id") or raw.get("id"),
        name=raw.get("name"),
        description=raw.get("description"),
        authorized=bool(config.get("authorized")),
        online=_is_online(last_seen_ms),
        ip_assignments=config.get("ipAssignments") or [],
        last_seen=(
            datetime.fromtimestamp(last_seen_ms / 1000, tz=timezone.utc) if last_seen_ms else None
        ),
        physical_address=raw.get("physicalAddress"),
        version=_format_version(config),
    )


def get_network_status(cfg: SystemSettings) -> dict:
    """Devuelve los datos crudos de la red (nombre, config, etc.)."""
    token = _token_for(cfg)
    return _request(token, "GET", f"/network/{cfg.zt_network_id}")


def list_members(cfg: SystemSettings) -> list[ZeroTierMember]:
    token = _token_for(cfg)
    raw_members = _request(token, "GET", f"/network/{cfg.zt_network_id}/member") or []
    return [_to_member_schema(m) for m in raw_members]


def get_member(cfg: SystemSettings, node_id: str) -> ZeroTierMember | None:
    """
    Devuelve un miembro puntual de la red por su node_id (10 hex).
    Devuelve None si el nodo no está en la red (404).
    """
    token = _token_for(cfg)
    raw = _request(
        token, "GET", f"/network/{cfg.zt_network_id}/member/{node_id}", allow_404=True
    )
    return _to_member_schema(raw) if raw else None
