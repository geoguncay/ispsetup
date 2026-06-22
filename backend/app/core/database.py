"""
Base SQLAlchemy declarativa y motor de base de datos.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# SQLite (tests) no soporta pool_size ni max_overflow
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

_engine_kwargs: dict = {"pool_pre_ping": True}
if not _is_sqlite:
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

engine = create_engine(settings.DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def run_migrations(bind_engine) -> None:
    """
    Ejecuta migraciones simples de base de datos para agregar las nuevas columnas a la tabla routers.
    """
    if not str(bind_engine.url).startswith("sqlite"):
        with bind_engine.connect() as conn:
            conn.execute(text("ALTER TABLE routers ADD COLUMN IF NOT EXISTS cola_padre VARCHAR(100);"))
            conn.execute(text("ALTER TABLE routers ADD COLUMN IF NOT EXISTS address_list VARCHAR(100);"))
            conn.execute(text("ALTER TABLE routers ADD COLUMN IF NOT EXISTS ancho_banda_up INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE routers ADD COLUMN IF NOT EXISTS ancho_banda_down INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url VARCHAR(255);"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS inactivity_timeout INTEGER DEFAULT 0;"))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS custom_services (
                id VARCHAR(36) PRIMARY KEY,
                nombre VARCHAR(120) NOT NULL UNIQUE,
                precio NUMERIC(10, 2) NOT NULL,
                descripcion VARCHAR(255),
                impuestos NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
                activo BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sites (
                id VARCHAR(36) PRIMARY KEY,
                nombre VARCHAR(120) NOT NULL UNIQUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            conn.execute(text("ALTER TABLE routers ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) REFERENCES sites(id);"))
            conn.commit()



