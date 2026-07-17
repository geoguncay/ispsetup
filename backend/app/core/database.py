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
    Ejecuta migraciones simples de base de datos para agregar las nuevas columnas a la tabla gateways.
    """
    if not str(bind_engine.url).startswith("sqlite"):
        with bind_engine.connect() as conn:
            # ── Migración: Router → Gateway (Renombrar tabla principal primero si existe como 'routers') ──
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'routers'
                ) THEN
                    ALTER TABLE routers RENAME TO gateways;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de gateways que tenían un ADD COLUMN histórico
            # con el nombre viejo (deben ejecutarse antes de los ADD COLUMN de abajo).
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'cola_padre'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN cola_padre TO parent_queue;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'ancho_banda_up'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN ancho_banda_up TO bandwidth_up;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'ancho_banda_down'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN ancho_banda_down TO bandwidth_down;
                END IF;
            END $$;
            """))

            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS parent_queue VARCHAR(100);"))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS address_list VARCHAR(100);"))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS bandwidth_up INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS bandwidth_down INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS config_mode VARCHAR(20) NOT NULL DEFAULT 'system';"))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS security_mode VARCHAR(30) NOT NULL DEFAULT 'none_api';"))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS traffic_accounting VARCHAR(30) NOT NULL DEFAULT 'traffic_flow';"))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS speed_control_type VARCHAR(30) NOT NULL DEFAULT 'simple_queues';"))
            conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'settings_configured'
                ) THEN
                    -- Los gateways existentes conservan el panel habilitado; los
                    -- creados después de esta migración comienzan sin configurar.
                    ALTER TABLE gateways
                        ADD COLUMN settings_configured BOOLEAN NOT NULL DEFAULT TRUE;
                    ALTER TABLE gateways
                        ALTER COLUMN settings_configured SET DEFAULT FALSE;
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url VARCHAR(255);"))
            conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS use_logo_on_login BOOLEAN NOT NULL DEFAULT FALSE;"))
            conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS login_bg_url VARCHAR(255);"))
            conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS use_login_bg BOOLEAN NOT NULL DEFAULT FALSE;"))
            # Renombrar columnas en español de users (tabla existía desde el inicio con
            # nombre/rol/activo; tipo_operador/permisos_router/horario_acceso/permisos
            # tenían un ADD COLUMN histórico con el nombre viejo — deben ejecutarse antes
            # de los ADD COLUMN de abajo).
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE users RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'rol'
                ) THEN
                    ALTER TABLE users RENAME COLUMN rol TO role;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'activo'
                ) THEN
                    ALTER TABLE users RENAME COLUMN activo TO active;
                END IF;
            END $$;
            """))
            # Renombrar el valor del ENUM nativo user_role: 'tecnico' -> 'technician'
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_enum e
                    JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'user_role' AND e.enumlabel = 'tecnico'
                ) THEN
                    ALTER TYPE user_role RENAME VALUE 'tecnico' TO 'technician';
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'tipo_operador'
                ) THEN
                    ALTER TABLE users RENAME COLUMN tipo_operador TO operator_type;
                    UPDATE users SET operator_type = 'administrator' WHERE operator_type = 'administrador';
                    UPDATE users SET operator_type = 'payments_operator' WHERE operator_type = 'operador_pagos';
                    UPDATE users SET operator_type = 'installer' WHERE operator_type = 'instalador';
                    UPDATE users SET operator_type = 'technical_support' WHERE operator_type = 'soporte_tecnico';
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'permisos_router'
                ) THEN
                    ALTER TABLE users RENAME COLUMN permisos_router TO gateway_permissions;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'horario_acceso'
                ) THEN
                    ALTER TABLE users RENAME COLUMN horario_acceso TO access_schedule;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'permisos'
                ) THEN
                    ALTER TABLE users RENAME COLUMN permisos TO permissions;
                    UPDATE users SET permissions = replace(permissions, 'clientes:ver', 'clients:view');
                    UPDATE users SET permissions = replace(permissions, 'clientes:crear', 'clients:create');
                    UPDATE users SET permissions = replace(permissions, 'pagos:registrar', 'payments:register');
                    UPDATE users SET permissions = replace(permissions, 'facturas:administrar', 'invoices:manage');
                    UPDATE users SET permissions = replace(permissions, 'inventario:administrar', 'inventory:manage');
                    UPDATE users SET permissions = replace(permissions, 'routers:administrar', 'gateways:manage');
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS inactivity_timeout INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS operator_type VARCHAR(50);"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS gateway_permissions VARCHAR(255);"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS access_schedule VARCHAR(100);"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions VARCHAR(500);"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);"))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS custom_services (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(120) NOT NULL UNIQUE,
                price NUMERIC(10, 2) NOT NULL,
                description VARCHAR(255),
                taxes NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sites (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(120) NOT NULL UNIQUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) REFERENCES sites(id);"))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS invoices (
                id VARCHAR(36) PRIMARY KEY,
                client_id VARCHAR(36) REFERENCES clients(id) ON DELETE CASCADE,
                plan_id VARCHAR(36) REFERENCES plans(id) ON DELETE SET NULL,
                period VARCHAR(10) NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                issue_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                due_date TIMESTAMP WITH TIME ZONE NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            # Renombrar columnas en español de invoices (tabla existía desde el inicio con estos nombres)
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'invoices' AND column_name = 'cliente_id'
                ) THEN
                    ALTER TABLE invoices RENAME COLUMN cliente_id TO client_id;
                    ALTER TABLE invoices RENAME COLUMN periodo TO period;
                    ALTER TABLE invoices RENAME COLUMN monto TO amount;
                    ALTER TABLE invoices RENAME COLUMN fecha_emision TO issue_date;
                    ALTER TABLE invoices RENAME COLUMN fecha_vencimiento TO due_date;
                    ALTER TABLE invoices RENAME COLUMN estado TO status;
                    UPDATE invoices SET status = 'pending' WHERE status = 'pendiente';
                    UPDATE invoices SET status = 'paid' WHERE status = 'pagado';
                    UPDATE invoices SET status = 'overdue' WHERE status = 'vencido';
                    ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'pending';
                END IF;
            END $$;
            """))
            # Renombrar columnas en español de payments que tenían un ADD COLUMN histórico
            # con el nombre viejo (deben ejecutarse antes de los ADD COLUMN de abajo).
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'payments' AND column_name = 'cliente_id'
                ) THEN
                    ALTER TABLE payments RENAME COLUMN cliente_id TO client_id;
                    ALTER TABLE payments RENAME COLUMN monto TO amount;
                    ALTER TABLE payments RENAME COLUMN fecha_pago TO payment_date;
                    ALTER TABLE payments RENAME COLUMN metodo TO method;
                    ALTER TABLE payments RENAME COLUMN estado TO status;
                    UPDATE payments SET method = 'cash' WHERE method = 'efectivo';
                    UPDATE payments SET method = 'transfer' WHERE method = 'transferencia';
                    UPDATE payments SET method = 'card' WHERE method = 'tarjeta';
                    UPDATE payments SET method = 'deposit' WHERE method = 'deposito';
                    UPDATE payments SET status = 'completed' WHERE status = 'completado';
                    UPDATE payments SET status = 'pending' WHERE status = 'pendiente';
                    UPDATE payments SET status = 'failed' WHERE status = 'fallido';
                    ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'completed';
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'payments' AND column_name = 'usuario_id'
                ) THEN
                    ALTER TABLE payments RENAME COLUMN usuario_id TO user_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'payments' AND column_name = 'notas'
                ) THEN
                    ALTER TABLE payments RENAME COLUMN notas TO notes;
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(36) REFERENCES invoices(id) ON DELETE SET NULL;"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL;"))
            conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes VARCHAR(255);"))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS client_custom_services (
                client_id VARCHAR(36) REFERENCES clients(id) ON DELETE CASCADE,
                custom_service_id VARCHAR(36) REFERENCES custom_services(id) ON DELETE CASCADE,
                PRIMARY KEY (client_id, custom_service_id)
            );
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'client_custom_services' AND column_name = 'cliente_id'
                ) THEN
                    ALTER TABLE client_custom_services RENAME COLUMN cliente_id TO client_id;
                END IF;
            END $$;
            """))
            # Renombrar columnas en español de la tabla custom_services (antes de agregar
            # recurring, para no dejar columnas duplicadas en instalaciones viejas)
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'custom_services' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE custom_services RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'custom_services' AND column_name = 'precio'
                ) THEN
                    ALTER TABLE custom_services RENAME COLUMN precio TO price;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'custom_services' AND column_name = 'descripcion'
                ) THEN
                    ALTER TABLE custom_services RENAME COLUMN descripcion TO description;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'custom_services' AND column_name = 'impuestos'
                ) THEN
                    ALTER TABLE custom_services RENAME COLUMN impuestos TO taxes;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'custom_services' AND column_name = 'activo'
                ) THEN
                    ALTER TABLE custom_services RENAME COLUMN activo TO active;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'custom_services' AND column_name = 'recurrente'
                ) THEN
                    ALTER TABLE custom_services RENAME COLUMN recurrente TO recurring;
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE custom_services ADD COLUMN IF NOT EXISTS recurring BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS invoice_custom_services (
                invoice_id VARCHAR(36) REFERENCES invoices(id) ON DELETE CASCADE,
                custom_service_id VARCHAR(36) REFERENCES custom_services(id) ON DELETE CASCADE,
                PRIMARY KEY (invoice_id, custom_service_id)
            );
            """))
            # Renombrar columnas en español de clients que tenían un ADD COLUMN histórico
            # con el nombre viejo (deben ejecutarse antes de los ADD COLUMN de abajo).
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'inicio_facturacion'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN inicio_facturacion TO billing_start;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'dia_inicio_periodo'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN dia_inicio_periodo TO billing_period_start_day;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'crear_factura_anticipo_dias'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN crear_factura_anticipo_dias TO invoice_advance_days;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'tipo_facturacion'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN tipo_facturacion TO billing_type;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'auto_aplicar_pago'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN auto_aplicar_pago TO auto_apply_payment;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'usar_credito_auto'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN usar_credito_auto TO use_auto_credit;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'prorrateo_separado'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN prorrateo_separado TO separate_proration;
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_start TIMESTAMP WITH TIME ZONE;"))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_period_start_day INTEGER DEFAULT 1;"))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS invoice_advance_days INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_type VARCHAR(20) DEFAULT 'forward';"))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_apply_payment BOOLEAN DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS use_auto_credit BOOLEAN DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS separate_proration BOOLEAN DEFAULT TRUE;"))
            # Renombrar columnas en español de la tabla inventory_items (antes de agregar
            # category/model, para no dejar columnas duplicadas en instalaciones viejas)
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'categoria'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN categoria TO category;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'modelo'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN modelo TO model;
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category VARCHAR(50);"))
            conn.execute(text("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS model VARCHAR(80);"))
            # Renombrar columnas en español de la tabla sites (antes de agregar
            # latitude/longitude, para no dejar columnas duplicadas en instalaciones viejas)
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'sites' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE sites RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'sites' AND column_name = 'latitud'
                ) THEN
                    ALTER TABLE sites RENAME COLUMN latitud TO latitude;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'sites' AND column_name = 'longitud'
                ) THEN
                    ALTER TABLE sites RENAME COLUMN longitud TO longitude;
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE sites ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;"))
            conn.execute(text("ALTER TABLE sites ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;"))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS system_settings (
                id VARCHAR(36) PRIMARY KEY,
                mikrotik_timeout INTEGER NOT NULL DEFAULT 10,
                mikrotik_attempts INTEGER NOT NULL DEFAULT 1,
                mikrotik_debug BOOLEAN NOT NULL DEFAULT FALSE,
                mikrotik_ssl BOOLEAN NOT NULL DEFAULT FALSE,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS product_categories (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(50) NOT NULL UNIQUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                user_name VARCHAR(150),
                action VARCHAR(60) NOT NULL,
                entity_type VARCHAR(60),
                entity_id VARCHAR(36),
                entity_name VARCHAR(250),
                detail JSONB,
                ip_address VARCHAR(45),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            # Renombrar columnas en español de audit_logs (tabla existía desde el inicio con estos nombres)
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'audit_logs' AND column_name = 'usuario_id'
                ) THEN
                    ALTER TABLE audit_logs RENAME COLUMN usuario_id TO user_id;
                    ALTER TABLE audit_logs RENAME COLUMN usuario_nombre TO user_name;
                    ALTER TABLE audit_logs RENAME COLUMN accion TO action;
                    ALTER TABLE audit_logs RENAME COLUMN entidad_tipo TO entity_type;
                    ALTER TABLE audit_logs RENAME COLUMN entidad_id TO entity_id;
                    ALTER TABLE audit_logs RENAME COLUMN entidad_nombre TO entity_name;
                    ALTER TABLE audit_logs RENAME COLUMN detalle TO detail;
                END IF;
            END $$;
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs(action);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_entity_type ON audit_logs(entity_type);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_entity_id ON audit_logs(entity_id);"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs(created_at DESC);"))
            conn.execute(text("DROP INDEX IF EXISTS ix_audit_logs_accion;"))
            conn.execute(text("DROP INDEX IF EXISTS ix_audit_logs_entidad_tipo;"))
            conn.execute(text("DROP INDEX IF EXISTS ix_audit_logs_entidad_id;"))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS client_inventory_items (
                id VARCHAR(36) PRIMARY KEY,
                client_id VARCHAR(36) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                inventory_item_id VARCHAR(36) NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
                quantity INTEGER NOT NULL DEFAULT 1,
                serial_number VARCHAR(100),
                mac VARCHAR(17),
                notes TEXT,
                assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_client_inventory_items_client_id ON client_inventory_items(client_id);"))
            # Este ALTER COLUMN solo aplica a instalaciones viejas que aún tengan la columna
            # con su nombre en español (una instalación nueva ya crea "phone" nullable).
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'telefono'
                ) THEN
                    ALTER TABLE clients ALTER COLUMN telefono DROP NOT NULL;
                END IF;
            END $$;
            """))
            # Renombrar columnas en español de clients que tenían un ADD COLUMN histórico
            # con el nombre viejo (deben ejecutarse antes de los ADD COLUMN de abajo).
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'suspension_programada'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN suspension_programada TO scheduled_suspension;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'suspension_programada_motivo'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN suspension_programada_motivo TO scheduled_suspension_reason;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'reactivacion_programada'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN reactivacion_programada TO scheduled_reactivation;
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS scheduled_suspension TIMESTAMP WITH TIME ZONE;"))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS scheduled_suspension_reason VARCHAR(255);"))
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS scheduled_reactivation TIMESTAMP WITH TIME ZONE;"))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS mikrotik_sync_queue (
                id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                gateway_id  UUID NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
                client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
                operation   VARCHAR(50) NOT NULL,
                payload     JSONB NOT NULL DEFAULT '{}',
                status      VARCHAR(20) NOT NULL DEFAULT 'pending',
                attempts    INTEGER NOT NULL DEFAULT 0,
                last_error  TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                next_retry_at TIMESTAMPTZ
            );
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_msq_gateway_status ON mikrotik_sync_queue(gateway_id, status);"))

            # ── Ajustes de Sistema: localización, fiscal, notificaciones, seguridad, mantenimiento, integraciones ──
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS loc_timezone VARCHAR(60) NOT NULL DEFAULT 'UTC';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS loc_locale VARCHAR(10) NOT NULL DEFAULT 'es';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS loc_currency_code VARCHAR(10) NOT NULL DEFAULT 'USD';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS loc_currency_symbol VARCHAR(5) NOT NULL DEFAULT '$';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS loc_date_format VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS fiscal_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS fiscal_tax_name VARCHAR(20) NOT NULL DEFAULT 'ITBIS';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS fiscal_invoice_prefix VARCHAR(20) NOT NULL DEFAULT 'FAC-';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS fiscal_invoice_next_number INTEGER NOT NULL DEFAULT 1;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255);"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 587;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS smtp_user VARCHAR(255);"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS smtp_password_encrypted TEXT;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS smtp_from_email VARCHAR(255);"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS smtp_from_name VARCHAR(120);"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS smtp_use_tls BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sec_password_min_length INTEGER NOT NULL DEFAULT 8;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sec_password_expiration_days INTEGER NOT NULL DEFAULT 0;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sec_default_session_timeout_minutes INTEGER NOT NULL DEFAULT 30;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sec_max_login_attempts INTEGER NOT NULL DEFAULT 5;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sec_lockout_duration_minutes INTEGER NOT NULL DEFAULT 15;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sec_ip_whitelist JSONB;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS maint_audit_log_retention_days INTEGER NOT NULL DEFAULT 90;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS maint_maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS maint_maintenance_message VARCHAR(500);"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS pg_api_key VARCHAR(255);"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS pg_api_secret_encrypted TEXT;"))
            # Renombrar columnas en español de system_settings que tenían un ADD COLUMN
            # histórico con el nombre viejo (deben ejecutarse antes de los ADD COLUMN de abajo).
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_hora_generacion'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_hora_generacion TO billing_generation_time;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_ciclo'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_ciclo TO billing_cycle;
                    UPDATE system_settings SET billing_cycle = 'monthly' WHERE billing_cycle = 'mensual';
                    UPDATE system_settings SET billing_cycle = 'bimonthly' WHERE billing_cycle = 'bimestral';
                    UPDATE system_settings SET billing_cycle = 'quarterly' WHERE billing_cycle = 'trimestral';
                    UPDATE system_settings SET billing_cycle = 'biannual' WHERE billing_cycle = 'semestral';
                    UPDATE system_settings SET billing_cycle = 'annual' WHERE billing_cycle = 'anual';
                    ALTER TABLE system_settings ALTER COLUMN billing_cycle SET DEFAULT 'monthly';
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_modo_precio'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_modo_precio TO billing_price_mode;
                    UPDATE system_settings SET billing_price_mode = 'included' WHERE billing_price_mode = 'incluido';
                    UPDATE system_settings SET billing_price_mode = 'excluded' WHERE billing_price_mode = 'excluido';
                    ALTER TABLE system_settings ALTER COLUMN billing_price_mode SET DEFAULT 'included';
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_auto_aprobar_enviar'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_auto_aprobar_enviar TO billing_auto_approve_send;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_detener_suspendidos'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_detener_suspendidos TO billing_stop_suspended;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_default_dia_pago'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_default_dia_pago TO billing_default_payment_day;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_generacion_modo'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_generacion_modo TO billing_generation_mode;
                    UPDATE system_settings SET billing_generation_mode = 'fixed_day' WHERE billing_generation_mode = 'dia_fijo';
                    UPDATE system_settings SET billing_generation_mode = 'cutoff_date' WHERE billing_generation_mode = 'fecha_corte';
                    UPDATE system_settings SET billing_generation_mode = 'billing_start' WHERE billing_generation_mode = 'inicio_facturacion';
                    ALTER TABLE system_settings ALTER COLUMN billing_generation_mode SET DEFAULT 'fixed_day';
                END IF;
            END $$;
            """))
            # billing_default_dias_gracia (ahora billing_default_grace_days) no tenía ningún efecto
            # real (quedó "muerto" desde su creación); ahora pasa a controlar el plazo de vencimiento
            # en modo "fixed_term", que antes era 10 días fijos en el código. Se actualiza el default
            # y las filas que aún tengan el valor inerte original para no cambiar el comportamiento
            # de instalaciones existentes al activar esta función.
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_default_dias_gracia'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_default_dias_gracia TO billing_default_grace_days;
                    ALTER TABLE system_settings ALTER COLUMN billing_default_grace_days SET DEFAULT 10;
                    UPDATE system_settings SET billing_default_grace_days = 10 WHERE billing_default_grace_days = 3;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_vencimiento_modo'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_vencimiento_modo TO billing_due_mode;
                    UPDATE system_settings SET billing_due_mode = 'fixed_term' WHERE billing_due_mode = 'plazo_fijo';
                    UPDATE system_settings SET billing_due_mode = 'cutoff_date' WHERE billing_due_mode = 'fecha_corte';
                    ALTER TABLE system_settings ALTER COLUMN billing_due_mode SET DEFAULT 'fixed_term';
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_vencimiento_hora'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_vencimiento_hora TO billing_due_time;
                    UPDATE system_settings SET billing_due_time = 'start_of_day' WHERE billing_due_time = 'inicio_dia';
                    UPDATE system_settings SET billing_due_time = 'end_of_day' WHERE billing_due_time = 'fin_dia';
                    ALTER TABLE system_settings ALTER COLUMN billing_due_time SET DEFAULT 'end_of_day';
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_aviso_nueva_factura'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_aviso_nueva_factura TO billing_advance_notice_enabled;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_aviso_previo_dias'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_aviso_previo_dias TO billing_advance_notice_days;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_recordatorios_pago'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_recordatorios_pago TO billing_payment_reminders;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'billing_recordatorio_frecuencia_dias'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN billing_recordatorio_frecuencia_dias TO billing_reminder_frequency_days;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'suspension_automatica'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN suspension_automatica TO suspension_automatic;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'suspension_hora'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN suspension_hora TO suspension_hour;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'suspension_retraso_dias'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN suspension_retraso_dias TO suspension_delay_days;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'suspension_permitir_aplazamiento'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN suspension_permitir_aplazamiento TO suspension_allow_deferral;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'suspension_notify_suspendido'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN suspension_notify_suspendido TO suspension_notify_suspended;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'suspension_notify_pospuesto'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN suspension_notify_pospuesto TO suspension_notify_deferred;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'suspension_motivos'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN suspension_motivos TO suspension_reasons;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'fechas_corte'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN fechas_corte TO cutoff_dates;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'system_settings' AND column_name = 'colas_padre'
                ) THEN
                    ALTER TABLE system_settings RENAME COLUMN colas_padre TO parent_queues;
                END IF;
            END $$;
            """))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_generation_time VARCHAR(5) NOT NULL DEFAULT '08:00';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_price_mode VARCHAR(20) NOT NULL DEFAULT 'included';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_auto_approve_send BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_stop_suspended BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_notify_new_invoice BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_attach_pdf_receipt BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_default_payment_day INTEGER NOT NULL DEFAULT 5;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_generation_mode VARCHAR(20) NOT NULL DEFAULT 'fixed_day';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_default_grace_days INTEGER NOT NULL DEFAULT 10;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_due_mode VARCHAR(20) NOT NULL DEFAULT 'fixed_term';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_due_time VARCHAR(20) NOT NULL DEFAULT 'end_of_day';"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_advance_notice_enabled BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_advance_notice_days INTEGER NOT NULL DEFAULT 5;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_payment_reminders BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS billing_reminder_frequency_days INTEGER NOT NULL DEFAULT 3;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS suspension_automatic BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS suspension_hour INTEGER NOT NULL DEFAULT 0;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS suspension_delay_days INTEGER NOT NULL DEFAULT 0;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS suspension_allow_deferral BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS suspension_notify_suspended BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS suspension_notify_deferred BOOLEAN NOT NULL DEFAULT TRUE;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS suspension_reasons JSONB;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS payment_methods JSONB;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS cutoff_dates JSONB;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS parent_queues JSONB;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS address_lists JSONB;"))
            conn.execute(text("ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS suspend_lists JSONB;"))
            conn.execute(text("ALTER TABLE gateways ADD COLUMN IF NOT EXISTS suspend_list VARCHAR(100);"))

            # Renombrar columna router_id → gateway_id en cada tabla relacionada
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'router_id'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN router_id TO gateway_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_profiles' AND column_name = 'router_id'
                ) THEN
                    ALTER TABLE pppoe_profiles RENAME COLUMN router_id TO gateway_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_secrets' AND column_name = 'router_id'
                ) THEN
                    ALTER TABLE pppoe_secrets RENAME COLUMN router_id TO gateway_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'static_ips' AND column_name = 'router_id'
                ) THEN
                    ALTER TABLE static_ips RENAME COLUMN router_id TO gateway_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'traffic_samples' AND column_name = 'router_id'
                ) THEN
                    ALTER TABLE traffic_samples RENAME COLUMN router_id TO gateway_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'traffic_samples' AND column_name = 'cliente_id'
                ) THEN
                    ALTER TABLE traffic_samples RENAME COLUMN cliente_id TO client_id;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla companies
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'companies' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE companies RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'companies' AND column_name = 'direccion'
                ) THEN
                    ALTER TABLE companies RENAME COLUMN direccion TO address;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'companies' AND column_name = 'telefono'
                ) THEN
                    ALTER TABLE companies RENAME COLUMN telefono TO phone;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'companies' AND column_name = 'sitio_web'
                ) THEN
                    ALTER TABLE companies RENAME COLUMN sitio_web TO website;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla suppliers
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suppliers' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE suppliers RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suppliers' AND column_name = 'telefono'
                ) THEN
                    ALTER TABLE suppliers RENAME COLUMN telefono TO phone;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suppliers' AND column_name = 'direccion'
                ) THEN
                    ALTER TABLE suppliers RENAME COLUMN direccion TO address;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suppliers' AND column_name = 'notas'
                ) THEN
                    ALTER TABLE suppliers RENAME COLUMN notas TO notes;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla plans
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'velocidad_down_mbps'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN velocidad_down_mbps TO speed_down_mbps;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'velocidad_up_mbps'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN velocidad_up_mbps TO speed_up_mbps;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'velocidad_down_kbps'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN velocidad_down_kbps TO speed_down_kbps;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'velocidad_up_kbps'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN velocidad_up_kbps TO speed_up_kbps;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'precio'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN precio TO price;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'descripcion'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN descripcion TO description;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'impuestos'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN impuestos TO taxes;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'plans' AND column_name = 'prioridad'
                ) THEN
                    ALTER TABLE plans RENAME COLUMN prioridad TO priority;
                END IF;
            END $$;
            """))

            # Renombrar columna en español de la tabla product_categories
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'product_categories' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE product_categories RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla inventory_items
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'codigo'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN codigo TO code;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'cantidad'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN cantidad TO quantity;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'minimo_alerta'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN minimo_alerta TO min_alert;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'precio_compra'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN precio_compra TO purchase_price;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'precio_venta'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN precio_venta TO sale_price;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'descripcion'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN descripcion TO description;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'inventory_items' AND column_name = 'proveedor_id'
                ) THEN
                    ALTER TABLE inventory_items RENAME COLUMN proveedor_id TO supplier_id;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla client_inventory_items
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'client_inventory_items' AND column_name = 'cantidad'
                ) THEN
                    ALTER TABLE client_inventory_items RENAME COLUMN cantidad TO quantity;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'client_inventory_items' AND column_name = 'numero_serie'
                ) THEN
                    ALTER TABLE client_inventory_items RENAME COLUMN numero_serie TO serial_number;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'client_inventory_items' AND column_name = 'notas'
                ) THEN
                    ALTER TABLE client_inventory_items RENAME COLUMN notas TO notes;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla tickets
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'tickets' AND column_name = 'cliente_id'
                ) THEN
                    ALTER TABLE tickets RENAME COLUMN cliente_id TO client_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'tickets' AND column_name = 'titulo'
                ) THEN
                    ALTER TABLE tickets RENAME COLUMN titulo TO title;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'tickets' AND column_name = 'descripcion'
                ) THEN
                    ALTER TABLE tickets RENAME COLUMN descripcion TO description;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'tickets' AND column_name = 'prioridad'
                ) THEN
                    ALTER TABLE tickets RENAME COLUMN prioridad TO priority;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'tickets' AND column_name = 'estado'
                ) THEN
                    ALTER TABLE tickets RENAME COLUMN estado TO status;
                END IF;
            END $$;
            """))
            # Traducir valores de texto tipo enum ya almacenados en tickets.priority/status
            conn.execute(text("""
                UPDATE tickets SET priority = CASE priority
                    WHEN 'baja' THEN 'low'
                    WHEN 'media' THEN 'medium'
                    WHEN 'alta' THEN 'high'
                    ELSE priority
                END
                WHERE priority IN ('baja', 'media', 'alta');
            """))
            conn.execute(text("""
                UPDATE tickets SET status = CASE status
                    WHEN 'abierto' THEN 'open'
                    WHEN 'en_proceso' THEN 'in_progress'
                    WHEN 'resuelto' THEN 'resolved'
                    WHEN 'cerrado' THEN 'closed'
                    ELSE status
                END
                WHERE status IN ('abierto', 'en_proceso', 'resuelto', 'cerrado');
            """))

            # Renombrar columnas en español de la tabla static_ips
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'static_ips' AND column_name = 'cliente_id'
                ) THEN
                    ALTER TABLE static_ips RENAME COLUMN cliente_id TO client_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'static_ips' AND column_name = 'notas'
                ) THEN
                    ALTER TABLE static_ips RENAME COLUMN notas TO notes;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla pppoe_secrets
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_secrets' AND column_name = 'cliente_id'
                ) THEN
                    ALTER TABLE pppoe_secrets RENAME COLUMN cliente_id TO client_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_secrets' AND column_name = 'usuario_ppp'
                ) THEN
                    ALTER TABLE pppoe_secrets RENAME COLUMN usuario_ppp TO ppp_username;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_secrets' AND column_name = 'contraseña_ppp'
                ) THEN
                    ALTER TABLE pppoe_secrets RENAME COLUMN "contraseña_ppp" TO ppp_password;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_secrets' AND column_name = 'perfil_id'
                ) THEN
                    ALTER TABLE pppoe_secrets RENAME COLUMN perfil_id TO profile_id;
                END IF;
            END $$;
            """))
            # Renombrar la restricción única que referenciaba el nombre viejo de la columna
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'uq_gateway_usuario_ppp'
                ) THEN
                    ALTER TABLE pppoe_secrets RENAME CONSTRAINT uq_gateway_usuario_ppp TO uq_gateway_ppp_username;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla pppoe_profiles
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_profiles' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE pppoe_profiles RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_profiles' AND column_name = 'velocidad_down_mbps'
                ) THEN
                    ALTER TABLE pppoe_profiles RENAME COLUMN velocidad_down_mbps TO speed_down_mbps;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pppoe_profiles' AND column_name = 'velocidad_up_mbps'
                ) THEN
                    ALTER TABLE pppoe_profiles RENAME COLUMN velocidad_up_mbps TO speed_up_mbps;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'uq_gateway_profile_nombre'
                ) THEN
                    ALTER TABLE pppoe_profiles RENAME CONSTRAINT uq_gateway_profile_nombre TO uq_gateway_profile_name;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla suspension_logs
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suspension_logs' AND column_name = 'cliente_id'
                ) THEN
                    ALTER TABLE suspension_logs RENAME COLUMN cliente_id TO client_id;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suspension_logs' AND column_name = 'motivo'
                ) THEN
                    ALTER TABLE suspension_logs RENAME COLUMN motivo TO reason;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suspension_logs' AND column_name = 'fecha_suspension'
                ) THEN
                    ALTER TABLE suspension_logs RENAME COLUMN fecha_suspension TO suspended_at;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suspension_logs' AND column_name = 'fecha_reactivacion'
                ) THEN
                    ALTER TABLE suspension_logs RENAME COLUMN fecha_reactivacion TO reactivated_at;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'suspension_logs' AND column_name = 'usuario_id'
                ) THEN
                    ALTER TABLE suspension_logs RENAME COLUMN usuario_id TO user_id;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla gateways
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'puerto_api'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN puerto_api TO api_port;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'usuario_api'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN usuario_api TO api_username;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'modelo_hw'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN modelo_hw TO hw_model;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'notas'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN notas TO notes;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'latitud'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN latitud TO latitude;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'longitud'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN longitud TO longitude;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'monitoreo_trafico'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN monitoreo_trafico TO traffic_monitoring;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'control_velocidad'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN control_velocidad TO speed_control;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'sincronizar_logs'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN sincronizar_logs TO sync_logs;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'notificaciones_alertas'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN notificaciones_alertas TO alert_notifications;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'gateways' AND column_name = 'activo'
                ) THEN
                    ALTER TABLE gateways RENAME COLUMN activo TO active;
                END IF;
            END $$;
            """))

            # Renombrar columnas en español de la tabla clients (sin historial de ADD COLUMN)
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'nombre'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN nombre TO name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'apellidos'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN apellidos TO last_name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'nombres'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN nombres TO first_name;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'telefono'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN telefono TO phone;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'direccion'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN direccion TO address;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'latitud'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN latitud TO latitude;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'longitud'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN longitud TO longitude;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'tipo'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN tipo TO connection_type;
                END IF;
            END $$;
            """))
            conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'clients' AND column_name = 'activo'
                ) THEN
                    ALTER TABLE clients RENAME COLUMN activo TO active;
                END IF;
            END $$;
            """))

            conn.commit()


