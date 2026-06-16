"""
RouterPool: pool de conexiones librouteros por router_id.
Mantiene máximo 2 conexiones simultáneas por router (límite RouterOS).
"""
import asyncio
import logging
from contextlib import contextmanager
from typing import Generator

import librouteros
from librouteros import connect
from librouteros.api import Api

from app.core.security import decrypt_secret
from app.models.router import Router

logger = logging.getLogger(__name__)

# Límite de conexiones simultáneas por router (restricción RouterOS)
MAX_CONNECTIONS_PER_ROUTER = 2


class RouterConnectionError(Exception):
    """Error al conectar a un router MikroTik."""
    pass


class RouterPool:
    """
    Singleton que administra conexiones activas a routers MikroTik.
    Usa un asyncio.Semaphore por router para limitar concurrencia.
    """

    _instance: "RouterPool | None" = None

    def __new__(cls) -> "RouterPool":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._semaphores: dict[str, asyncio.Semaphore] = {}
            cls._instance._active_connections: dict[str, Api] = {}
        return cls._instance

    def _get_semaphore(self, router_id: str) -> asyncio.Semaphore:
        if router_id not in self._semaphores:
            self._semaphores[router_id] = asyncio.Semaphore(MAX_CONNECTIONS_PER_ROUTER)
        return self._semaphores[router_id]

    @contextmanager
    def connect_to(self, router: Router) -> Generator[Api, None, None]:
        """
        Context manager síncrono que devuelve una conexión activa al router.
        Descifra la contraseña con Fernet antes de conectar.
        Lanza RouterConnectionError si falla la conexión.
        """
        password = decrypt_secret(router.password_enc)
        api: Api | None = None
        try:
            api = connect(
                host=router.ip,
                username=router.usuario_api,
                password=password,
                port=router.puerto_api,
                timeout=10,
            )
            logger.info(f"Conexión establecida a router {router.nombre} ({router.ip})")
            yield api
        except librouteros.exceptions.TrapError as e:
            logger.warning(f"TrapError conectando a {router.nombre}: {e}")
            raise RouterConnectionError(f"Error de autenticación en {router.nombre}: {e}") from e
        except OSError as e:
            logger.warning(f"OSError conectando a {router.nombre}: {e}")
            raise RouterConnectionError(
                f"No se puede alcanzar {router.nombre} ({router.ip}:{router.puerto_api}): {e}"
            ) from e
        except Exception as e:
            logger.error(f"Error inesperado conectando a {router.nombre}: {e}")
            raise RouterConnectionError(f"Error inesperado: {e}") from e
        finally:
            if api is not None:
                try:
                    api.close()
                except Exception:
                    pass


# Singleton global
router_pool = RouterPool()
