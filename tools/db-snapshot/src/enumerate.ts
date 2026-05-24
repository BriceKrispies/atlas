/**
 * Schema enumeration — discover the tables, columns, and primary keys of a
 * live database so capture can SELECT them deterministically.
 *
 * - Tables: all BASE tables in the target schema(s), excluding the
 *   `_migrations` bookkeeping table (handled specially) — actually we INCLUDE
 *   `_migrations` so the bundle records the applied set, but diff treats it as
 *   a set-match (see `diff.ts`).
 * - Columns: `information_schema.columns` ordered by `ordinal_position`,
 *   DROPPING generated columns (`is_generated = 'ALWAYS'`) — those are
 *   Postgres-derived (e.g. `catalog_search_documents.search_vector`) and must
 *   not be captured or restored.
 * - Primary key: `pg_index` / `pg_attribute` join, in key order, for a
 *   deterministic row sort.
 */
import type postgres from 'postgres';
import type { ColumnMeta, TableMeta } from './types.ts';

/** Schemas we capture from a control-plane DB. */
export const CONTROL_PLANE_SCHEMAS = ['control_plane'] as const;
/** Schemas we capture from a tenant DB. */
export const TENANT_SCHEMAS = ['public'] as const;

interface RawColumn {
    table_schema: string;
    table_name: string;
    column_name: string;
    ordinal_position: number;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    is_generated: string;
}

/**
 * List BASE tables in the given schemas.
 */
export async function listTables(
    sql: postgres.Sql,
    schemas: readonly string[],
): Promise<{ schema: string; table: string }[]> {
    const rows = await sql<{ table_schema: string; table_name: string }[]>`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema = ANY(${schemas as string[]}::text[])
    ORDER BY table_schema, table_name
  `;
    return rows.map((r) => ({ schema: r.table_schema, table: r.table_name }));
}

/**
 * Columns for the given tables, ordinal-ordered, generated columns dropped.
 * Returns a map keyed by `schema.table`.
 */
export async function listColumns(
    sql: postgres.Sql,
    schemas: readonly string[],
): Promise<Map<string, ColumnMeta[]>> {
    const rows = await sql<RawColumn[]>`
    SELECT table_schema, table_name, column_name, ordinal_position,
           data_type, udt_name, is_nullable, is_generated
    FROM information_schema.columns
    WHERE table_schema = ANY(${schemas as string[]}::text[])
    ORDER BY table_schema, table_name, ordinal_position
  `;
    const byTable = new Map<string, ColumnMeta[]>();
    for (const r of rows) {
        // Drop Postgres-derived generated columns — they cannot be inserted
        // and re-derive identically on restore.
        if (r.is_generated === 'ALWAYS') continue;
        const key = `${r.table_schema}.${r.table_name}`;
        const list = byTable.get(key) ?? [];
        list.push({
            name: r.column_name,
            ordinalPosition: r.ordinal_position,
            dataType: r.data_type,
            udtName: r.udt_name,
            nullable: r.is_nullable === 'YES',
        });
        byTable.set(key, list);
    }
    return byTable;
}

/**
 * Primary-key columns (in key order) for the given tables. Returns a map
 * keyed by `schema.table`; tables without a PK are absent.
 */
export async function listPrimaryKeys(
    sql: postgres.Sql,
    schemas: readonly string[],
): Promise<Map<string, string[]>> {
    const rows = await sql<{ schema: string; table: string; column: string; ord: number }[]>`
    SELECT
      n.nspname               AS schema,
      c.relname               AS table,
      a.attname               AS column,
      array_position(i.indkey, a.attnum) AS ord
    FROM pg_index i
    JOIN pg_class c        ON c.oid = i.indrelid
    JOIN pg_namespace n    ON n.oid = c.relnamespace
    JOIN pg_attribute a    ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
    WHERE i.indisprimary
      AND n.nspname = ANY(${schemas as string[]}::text[])
    ORDER BY n.nspname, c.relname, ord
  `;
    const byTable = new Map<string, string[]>();
    for (const r of rows) {
        const key = `${r.schema}.${r.table}`;
        const list = byTable.get(key) ?? [];
        list.push(r.column);
        byTable.set(key, list);
    }
    return byTable;
}

/**
 * Build the full `TableMeta[]` for a database, joining tables + columns + PKs.
 */
export async function enumerateSchema(
    sql: postgres.Sql,
    schemas: readonly string[],
): Promise<TableMeta[]> {
    const [tables, columns, pks] = await Promise.all([
        listTables(sql, schemas),
        listColumns(sql, schemas),
        listPrimaryKeys(sql, schemas),
    ]);
    const metas: TableMeta[] = [];
    for (const { schema, table } of tables) {
        const key = `${schema}.${table}`;
        const cols = columns.get(key) ?? [];
        if (cols.length === 0) continue; // skip tables with no capturable columns
        metas.push({
            table,
            schema,
            columns: cols,
            primaryKey: pks.get(key) ?? [],
        });
    }
    return metas;
}

/**
 * Read the applied `_migrations` filename set for a DB. Control-plane keeps it
 * in `control_plane._migrations`; tenant DBs in `public._migrations`.
 */
export async function readMigrationSet(
    sql: postgres.Sql,
    kind: 'control-plane' | 'tenant',
): Promise<string[]> {
    const table = kind === 'control-plane' ? 'control_plane._migrations' : 'public._migrations';
    const rows = await sql.unsafe<{ filename: string }[]>(
        `SELECT filename FROM ${table} ORDER BY filename`,
    );
    return rows.map((r) => r.filename);
}

/**
 * Enumerate provisioned tenant DBs from `control_plane.tenants`. Only rows
 * with non-null `db_*` coordinates have a per-tenant database to capture.
 */
export async function listProvisionedTenants(
    controlSql: postgres.Sql,
): Promise<
    {
        tenantId: string;
        dbHost: string;
        dbPort: number;
        dbName: string;
        dbUser: string;
        dbPassword: string;
    }[]
> {
    const rows = await controlSql<
        {
            tenant_id: string;
            db_host: string | null;
            db_port: number | null;
            db_name: string | null;
            db_user: string | null;
            db_password: string | null;
        }[]
    >`
    SELECT tenant_id, db_host, db_port, db_name, db_user, db_password
    FROM control_plane.tenants
    WHERE db_host IS NOT NULL
      AND db_port IS NOT NULL
      AND db_name IS NOT NULL
      AND db_user IS NOT NULL
      AND db_password IS NOT NULL
    ORDER BY tenant_id
  `;
    return rows.map((r) => ({
        tenantId: r.tenant_id,
        dbHost: r.db_host!,
        dbPort: r.db_port!,
        dbName: r.db_name!,
        dbUser: r.db_user!,
        dbPassword: r.db_password!,
    }));
}
