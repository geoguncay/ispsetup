"""
Configuración central de la aplicación usando Pydantic Settings v2.
Lee variables de entorno desde .env automáticamente.
"""
from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────
    APP_NAME: str = "ISP Platform"
    ENVIRONMENT: Literal["development", "production"] = "development"
    DEBUG: bool = False

    # ── Base de datos ─────────────────────────────────────────
    DATABASE_URL: str

    # ── Redis ─────────────────────────────────────────────────
    REDIS_URL: str = "redis://redis:6379/0"

    # ── JWT / Seguridad ───────────────────────────────────────
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    # ── Fernet (cifrado de credenciales de routers) ───────────
    FERNET_KEY: str

    # ── Usuario admin inicial (seed) ──────────────────────────
    ADMIN_SEED_EMAIL: str = "admin@email.com"
    ADMIN_SEED_PASSWORD: str = "t3PXeS4tnt"
    ADMIN_SEED_NOMBRE: str = "Geo"
    # Clave secreta para el endpoint POST /auth/setup (requerida en producción)
    ADMIN_SEED_KEY: str | None = None

    # ── CORS ──────────────────────────────────────────────────
    ALLOWED_ORIGINS: str | list[str] = [
        "http://localhost:5173",
        "http://localhost:80",
    ]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v


@lru_cache
def get_settings() -> Settings:
    """Singleton de configuración; se cachea tras la primera llamada."""
    return Settings()


settings = get_settings()
