"""
Regresión: `run_migrations` debe correr en AUTOCOMMIT.

En una sola transacción larga, los ALTER TABLE ya ejecutados retienen ACCESS EXCLUSIVE
hasta el final; un worker de Celery con una lectura abierta sobre otra tabla que pide
una segunda conexión (health check de balanceadores → system_settings) deja a la
migración y al worker esperándose mutuamente, y la API nunca termina de arrancar.
"""
from unittest.mock import MagicMock

from app.core.database import run_migrations


def _fake_postgres_engine():
    engine = MagicMock()
    engine.url = "postgresql://user:pw@db/app"
    conn = MagicMock()
    ctx = MagicMock()
    ctx.__enter__.return_value = conn
    engine.connect.return_value.execution_options.return_value = ctx
    return engine, conn


def test_run_migrations_uses_autocommit_connection():
    engine, conn = _fake_postgres_engine()

    run_migrations(engine)

    engine.connect.return_value.execution_options.assert_called_once_with(isolation_level="AUTOCOMMIT")
    assert conn.execute.call_count > 100  # sí ejecutó las migraciones sobre esa conexión


def test_run_migrations_does_not_hold_one_big_transaction():
    engine, conn = _fake_postgres_engine()

    run_migrations(engine)

    # En AUTOCOMMIT no hay nada que confirmar al final; un commit() explícito delataría
    # que alguien volvió al modelo de transacción única.
    conn.commit.assert_not_called()


def test_run_migrations_skips_sqlite():
    engine = MagicMock()
    engine.url = "sqlite://"

    run_migrations(engine)

    engine.connect.assert_not_called()
