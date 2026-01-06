ALTER TABLE control_plane.tenants
ADD COLUMN IF NOT EXISTS db_host TEXT,
ADD COLUMN IF NOT EXISTS db_port INTEGER,
ADD COLUMN IF NOT EXISTS db_name TEXT,
ADD COLUMN IF NOT EXISTS db_user TEXT,
ADD COLUMN IF NOT EXISTS db_password TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_db_name ON control_plane.tenants(db_name);
