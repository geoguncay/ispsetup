BEGIN;

ALTER TABLE gateways
    ADD COLUMN IF NOT EXISTS security_mode VARCHAR(30) NOT NULL DEFAULT 'none_api',
    ADD COLUMN IF NOT EXISTS traffic_accounting VARCHAR(30) NOT NULL DEFAULT 'traffic_flow',
    ADD COLUMN IF NOT EXISTS speed_control_type VARCHAR(30) NOT NULL DEFAULT 'simple_queues';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'gateways' AND column_name = 'settings_configured'
    ) THEN
        ALTER TABLE gateways
            ADD COLUMN settings_configured BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE gateways
            ALTER COLUMN settings_configured SET DEFAULT FALSE;
    END IF;
END $$;

COMMIT;
