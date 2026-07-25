-- Renombra la columna `clients.name` a `clients.full_name` para reflejar que es
-- el nombre completo (derivado de last_name + first_name), evitando confusión
-- con los campos separados de apellidos/nombres. La misma migración se aplica
-- automáticamente desde core/database.py.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'clients' AND column_name = 'name'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'clients' AND column_name = 'full_name'
    ) THEN
        ALTER TABLE clients RENAME COLUMN name TO full_name;
    END IF;
END $$;
