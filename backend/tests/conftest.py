"""
conftest.py — Configuración global de pytest.

IMPORTANTE: Este archivo es importado por pytest ANTES que cualquier módulo
de la aplicación, por lo que establecer variables de entorno aquí garantiza
que `app.core.config.settings` las vea desde el primer momento.

Esto resuelve el error:
    psycopg2.OperationalError: could not translate host name "postgres"
que ocurre al correr los tests fuera de Docker porque DATABASE_URL apunta
a `postgres:5432` (host de Docker).  Aquí lo sobreescribimos con SQLite.
"""

import os

# ── Forzar variables de entorno de test ANTES de importar la app ─────────────
# Se usa asignación directa (no setdefault) para sobreescribir lo que venga
# del .env o del shell.  Así los tests nunca intentan conectar a los hosts
# Docker (postgres:5432, redis:6379) que solo existen dentro del contenedor.
os.environ["DATABASE_URL"] = "sqlite://"               # SQLite in-memory
os.environ["REDIS_URL"] = "redis://localhost:6379/0"   # Redis local; los tests mockean Redis

# SECRET_KEY y FERNET_KEY son requeridos por pydantic-settings.
# Si el usuario ya tiene valores en el entorno los respetamos; si no, ponemos
# valores de prueba válidos para que la validación de Settings no falle.
os.environ.setdefault(
    "SECRET_KEY",
    "0000000000000000000000000000000000000000000000000000000000000000",
)
os.environ.setdefault(
    "FERNET_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
)
