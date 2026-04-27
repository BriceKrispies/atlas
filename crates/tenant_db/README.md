# atlas-platform-tenant-db

Per-tenant database schema management. Each Atlas tenant has its own physical Postgres database; this crate owns the migration runner that brings a freshly-created tenant DB up to the current schema.

Migrations live under `migrations/` and follow the convention `YYYYMMDDHHMMSS_description.sql`. They are tracked in a `public._migrations` table inside each tenant database (one row per applied filename).

The directory ships empty in Chunk A — the catalog schema lands in Chunk C.
