"""
GatewayPool: pool de conexiones librouteros por gateway_id.
Lee timeout, attempts, debug y ssl desde SystemSettings (DB), con caché de 60 s.
"""
import asyncio
import logging
import ssl
import time
from contextlib import contextmanager
from typing import Generator

import librouteros
from librouteros import connect
from librouteros.api import Api

from app.core.security import decrypt_secret
from app.models.gateway import Gateway

logger = logging.getLogger(__name__)

MAX_CONNECTIONS_PER_GATEWAY = 2
_CONFIG_TTL = 60  # segundos de vida del caché de configuración


def _load_config_from_db() -> dict:
    """Lee SystemSettings de la DB. Devuelve defaults si no existe registro."""
    from app.core.database import SessionLocal
    from app.models.system_settings import SystemSettings

    db = SessionLocal()
    try:
        cfg = db.query(SystemSettings).first()
        if cfg:
            return {
                "timeout": cfg.mikrotik_timeout,
                "attempts": cfg.mikrotik_attempts,
                "debug": cfg.mikrotik_debug,
                "ssl": cfg.mikrotik_ssl,
            }
    except Exception as exc:
        logger.warning(f"No se pudo leer SystemSettings, usando defaults: {exc}")
    finally:
        db.close()

    return {"timeout": 10, "attempts": 1, "debug": False, "ssl": False}


class GatewayConnectionError(Exception):
    """Error al conectar a un router MikroTik."""
    pass


class GatewayPool:
    """
    Singleton que administra conexiones activas a routers MikroTik.
    Usa un asyncio.Semaphore por router para limitar concurrencia.
    """

    _instance: "GatewayPool | None" = None

    def __new__(cls) -> "GatewayPool":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._semaphores: dict[str, asyncio.Semaphore] = {}
            cls._instance._active_connections: dict[str, Api] = {}
            cls._instance._config_cache: dict | None = None
            cls._instance._config_cache_time: float = 0.0
        return cls._instance

    def _get_config(self) -> dict:
        if self._config_cache is None or time.monotonic() - self._config_cache_time > _CONFIG_TTL:
            self._config_cache = _load_config_from_db()
            self._config_cache_time = time.monotonic()
            if self._config_cache["debug"]:
                logging.getLogger("librouteros").setLevel(logging.DEBUG)
            else:
                logging.getLogger("librouteros").setLevel(logging.WARNING)
        return self._config_cache

    def invalidate_config_cache(self) -> None:
        """Fuerza recarga de configuración en la próxima conexión."""
        self._config_cache = None
        self._config_cache_time = 0.0

    def _get_semaphore(self, gateway_id: str) -> asyncio.Semaphore:
        if gateway_id not in self._semaphores:
            self._semaphores[gateway_id] = asyncio.Semaphore(MAX_CONNECTIONS_PER_GATEWAY)
        return self._semaphores[gateway_id]

    def _build_ssl_wrapper(self):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx.wrap_socket

    @contextmanager
    def connect_to(self, gateway: Gateway) -> Generator[Api, None, None]:
        """
        Context manager síncrono que devuelve una conexión activa al router.
        Aplica timeout, attempts y ssl desde SystemSettings.
        """
        cfg = self._get_config()
        password = decrypt_secret(gateway.password_enc)
        api: Api | None = None

        ssl_wrapper = self._build_ssl_wrapper() if cfg["ssl"] else None

        connect_kwargs: dict = {
            "host": gateway.ip,
            "username": gateway.api_username,
            "password": password,
            "port": gateway.api_port,
            "timeout": cfg["timeout"],
            "encoding": "utf-8",
        }
        if ssl_wrapper is not None:
            connect_kwargs["ssl_wrapper"] = ssl_wrapper

        last_exc: Exception | None = None
        for attempt in range(max(1, cfg["attempts"])):
            try:
                api = connect(**connect_kwargs)
                logger.info(
                    f"Conexión establecida a {gateway.name} ({gateway.ip}) "
                    f"[intento {attempt + 1}/{cfg['attempts']}, timeout={cfg['timeout']}s, ssl={cfg['ssl']}]"
                )
                break
            except (librouteros.exceptions.TrapError,):
                # Error de autenticación — no tiene sentido reintentar
                raise GatewayConnectionError(
                    f"Error de autenticación en {gateway.name}: credenciales incorrectas"
                )
            except (OSError, Exception) as exc:
                last_exc = exc
                logger.warning(
                    f"Intento {attempt + 1}/{cfg['attempts']} fallido para {gateway.name}: {exc}"
                )
                if attempt < cfg["attempts"] - 1:
                    time.sleep(1)

        if api is None:
            raise GatewayConnectionError(
                f"No se puede alcanzar {gateway.name} ({gateway.ip}:{gateway.api_port}) "
                f"tras {cfg['attempts']} intento(s): {last_exc}"
            )

        try:
            yield api
        finally:
            try:
                api.close()
            except Exception:
                pass


# Singleton global
gateway_pool = GatewayPool()
