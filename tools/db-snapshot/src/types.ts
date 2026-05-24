/**
 * Shared types for the Atlas-aware DB snapshot tool.
 *
 * The snapshot format is **structured JSON** (NOT pg_dump) so the bundle is
 * diffable, codec-aware, and reproducible byte-for-byte on restore. See
 * `README.md` for the format contract.
 *
 * A `SnapshotBundle` is the in-memory shape; `serialize.ts` writes it as one
 * JSON file per database plus a `manifest.json`.
 */

/** Kind of database in the Atlas topology. */
export type DatabaseKind = 'control-plane' | 'tenant';

/**
 * Per-column metadata captured from `information_schema.columns`. Drives the
 * codec: `dataType` + `udtName` decide how a raw value is encoded/decoded.
 */
export interface ColumnMeta {
    /** Column name. */
    name: string;
    /** 1-based position; capture SELECTs use this order so rows are stable. */
    ordinalPosition: number;
    /** `data_type` from information_schema (e.g. `bigint`, `ARRAY`, `jsonb`). */
    dataType: string;
    /** `udt_name` (e.g. `int8`, `_text`, `bytea`, `timestamptz`). */
    udtName: string;
    /** `is_nullable = 'YES'`. */
    nullable: boolean;
}

/** Per-table metadata (columns + primary-key ordering). */
export interface TableMeta {
    /** Schema-qualified? No — schema captured separately on the DB. */
    table: string;
    /** Postgres schema the table lives in (`public` or `control_plane`). */
    schema: string;
    /** Captured columns in ordinal order, EXCLUDING generated columns. */
    columns: ColumnMeta[];
    /**
     * Primary-key column names in key order. Used to build a deterministic
     * `ORDER BY` for the capture SELECT so two captures of unchanged data
     * produce byte-identical row arrays. Empty when the table has no PK.
     */
    primaryKey: string[];
}

/**
 * One table's captured rows. `columns` is the ordinal column-name list the
 * `rows` arrays are positionally aligned to. Each row is an array of
 * codec-encoded JSON values (see `encode.ts`).
 */
export interface TableSnapshot {
    table: string;
    schema: string;
    /** Column names in the exact order each row tuple follows. */
    columns: string[];
    /** Row tuples; each is `columns.length` codec-encoded values. */
    rows: unknown[][];
    rowCount: number;
}

/** One database's full snapshot. */
export interface DatabaseSnapshot {
    /** Physical Postgres database name (e.g. `control_plane`, `atlas_t_acme`). */
    database: string;
    kind: DatabaseKind;
    /** Set for tenant DBs; the `control_plane.tenants.tenant_id`. */
    tenantId?: string;
    /**
     * For tenant DBs: the verbatim connection coordinates captured from
     * `control_plane.tenants` so restore can recreate the role with the exact
     * password. Absent for the control-plane DB.
     */
    connection?: TenantConnectionSnapshot;
    /** The `_migrations.filename` set applied to this DB at capture time. */
    migrations: string[];
    tables: TableSnapshot[];
}

/**
 * Verbatim per-tenant connection info captured from `control_plane.tenants`.
 * Restore recreates the runtime role with this exact password (NOT a freshly
 * generated one) so the captured `control_plane` rows stay internally
 * consistent and any captured tenant DB authenticates.
 */
export interface TenantConnectionSnapshot {
    dbHost: string;
    dbPort: number;
    dbName: string;
    dbUser: string;
    dbPassword: string;
}

/** Top-level bundle: timestamp + every database snapshot. */
export interface SnapshotBundle {
    /** ISO-8601 capture timestamp. */
    capturedAt: string;
    databases: DatabaseSnapshot[];
}

/** Per-database manifest entry. */
export interface ManifestDatabaseEntry {
    database: string;
    kind: DatabaseKind;
    tenantId?: string;
    /** Output filename relative to the golden dir. */
    file: string;
    /** sha256 hex of the serialized DB file. */
    sha256: string;
    /** Per-table row counts. */
    tables: { table: string; schema: string; rowCount: number }[];
    /** The `_migrations.filename` set for this DB. */
    migrations: string[];
}

/** `manifest.json` shape. */
export interface Manifest {
    capturedAt: string;
    databases: ManifestDatabaseEntry[];
}

/** A single detected difference between golden and actual. */
export interface Diff {
    /** Physical database name. */
    database: string;
    /** Schema-qualified table, e.g. `public.events`. */
    table: string;
    /**
     * Diff kind:
     *   - `missing-table`  — table present in golden, absent in actual (or vice-versa)
     *   - `row-count`      — same table, different number of rows
     *   - `cell`           — a specific cell differs
     *   - `missing-row`    — a keyed row present on one side only
     *   - `migration-set`  — `_migrations` filename sets differ
     *   - `column-set`     — captured column lists differ
     */
    kind:
        | 'missing-table'
        | 'row-count'
        | 'cell'
        | 'missing-row'
        | 'migration-set'
        | 'column-set';
    /** Human-readable detail. */
    detail: string;
    /** Optional row index (capture order) for cell/missing-row diffs. */
    rowIndex?: number;
    /** Optional column name for cell diffs. */
    column?: string;
    /** Golden side value (codec-encoded). */
    golden?: unknown;
    /** Actual side value (codec-encoded). */
    actual?: unknown;
}
