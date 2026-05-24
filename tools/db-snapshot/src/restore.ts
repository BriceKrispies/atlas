/**
 * restore — orchestrate a verbatim restore of a captured `SnapshotBundle`.
 *
 * Order:
 *   1. Control-plane:
 *      a. `runMigrations(cp, 'control-plane')` — builds the schema + populates
 *         `control_plane._migrations`.
 *      b. ASSERT the captured migration filename set matches what was applied
 *         (we do NOT insert `_migrations` rows — the runner owns them — but the
 *         captured set must equal the applied set, else schema drift).
 *      c. INSERT the captured rows VERBATIM in `CONTROL_PLANE_INSERT_ORDER`
 *         (FK-respecting). We do NOT call any seed routine — the goal is exact
 *         reproduction of the captured data, not a re-seed.
 *   2. Each tenant DB:
 *      a. create-tenant-db (verbatim password) + (optional) scratch rename.
 *      b. `runMigrations(t, 'tenant')` as the provisioner.
 *      c. replay CRUD grants for the runtime role.
 *      d. insert-rows verbatim (events with explicit seq), FK order.
 *      e. reset-sequences.
 *
 * The control-plane `tenants` rows can be rewritten to point `db_name` at
 * scratch databases for a round-trip test (see `RestoreOptions.tenantDbRename`).
 */
import postgres from 'postgres';
// Relative import (tools/ is not a workspace package) — mirrors scripts/dev-up.ts.
import { runMigrations } from '../../../adapters/node/src/migrations/runner.ts';
import type {
    ColumnMeta,
    DatabaseSnapshot,
    SnapshotBundle,
    TableSnapshot,
} from './types.ts';
import { createTenantDb, replayGrants } from './create-tenant-db.ts';
import { insertTableRows } from './insert-rows.ts';
import { resetSequences } from './reset-sequences.ts';

/**
 * FK-respecting insert order for control-plane tables. Parents before children.
 * `_migrations` is intentionally absent (runner owns it).
 */
export const CONTROL_PLANE_INSERT_ORDER = [
    'tenants',
    'modules',
    'module_versions',
    'tenant_modules',
    'policies',
    'custom_domains',
    'entity_type_registry',
    'field_registry',
    'index_registry',
    'schema_registry',
    'intent_schemas',
    'action_entries',
    'signup_requests',
    'email_log',
    'registry_version',
] as const;

/**
 * FK-respecting insert order for tenant tables. `repositories` before
 * `repository_revisions`; DSL current before its versions table is unnecessary
 * (no FK) but kept grouped. Tables not listed are appended in capture order.
 */
export const TENANT_INSERT_ORDER = [
    'events',
    'worker_cursors',
    'cache_entries',
    'projections',
    'catalog_state',
    'catalog_search_documents',
    'entities',
    'relations',
    'repositories',
    'repository_revisions',
    '_atlas_dsl_expression',
    '_atlas_dsl_expression_versions',
] as const;

export interface RestoreOptions {
    /** Privileged superuser connection coordinates (control-plane). */
    superuser: {
        host: string;
        port: number;
        user: string;
        password: string;
    };
    /** Target control-plane database name (scratch in tests). */
    controlPlaneDatabase: string;
    /**
     * Optional map tenantId → scratch db name. When set, the tenant DB is
     * created under the scratch name AND the captured `control_plane.tenants`
     * row's `db_name` is rewritten to the scratch name before insert, keeping
     * the restored control-plane internally consistent.
     */
    tenantDbRename?: Record<string, string>;
    /** Skip tenant DB restore (control-plane only). */
    controlPlaneOnly?: boolean;
}

/** Build a name→ColumnMeta-list reconstruction from a TableSnapshot. */
function metaFromSnapshot(table: TableSnapshot): ColumnMeta[] {
    // The snapshot stores column names only; we reconstruct minimal ColumnMeta
    // by querying the live restored DB instead. To avoid a round-trip per
    // table, the caller passes live column metadata. This helper is unused at
    // runtime but documents the shape; restore() fetches real metadata.
    return table.columns.map((name, i) => ({
        name,
        ordinalPosition: i + 1,
        dataType: 'unknown',
        udtName: 'unknown',
        nullable: true,
    }));
}

/** Read live ColumnMeta for a schema from the restored DB. */
async function liveColumns(
    sql: postgres.Sql,
    schema: string,
): Promise<Map<string, ColumnMeta[]>> {
    const rows = await sql<
        {
            table_name: string;
            column_name: string;
            ordinal_position: number;
            data_type: string;
            udt_name: string;
            is_nullable: string;
            is_generated: string;
        }[]
    >`
    SELECT table_name, column_name, ordinal_position, data_type, udt_name,
           is_nullable, is_generated
    FROM information_schema.columns
    WHERE table_schema = ${schema}
    ORDER BY table_name, ordinal_position
  `;
    const byTable = new Map<string, ColumnMeta[]>();
    for (const r of rows) {
        if (r.is_generated === 'ALWAYS') continue;
        const list = byTable.get(r.table_name) ?? [];
        list.push({
            name: r.column_name,
            ordinalPosition: r.ordinal_position,
            dataType: r.data_type,
            udtName: r.udt_name,
            nullable: r.is_nullable === 'YES',
        });
        byTable.set(r.table_name, list);
    }
    return byTable;
}

/** Order a database's tables by the given insert order, appending unknowns. */
function orderTables(tables: TableSnapshot[], order: readonly string[]): TableSnapshot[] {
    const byName = new Map(tables.map((t) => [t.table, t]));
    const out: TableSnapshot[] = [];
    for (const name of order) {
        const t = byName.get(name);
        if (t) {
            out.push(t);
            byName.delete(name);
        }
    }
    // Append any captured table not in the explicit order (skip _migrations).
    for (const t of byName.values()) {
        if (t.table === '_migrations') continue;
        out.push(t);
    }
    return out;
}

/** Assert the captured migration set equals what the runner applied. */
export function assertMigrationSet(captured: string[], applied: string[]): void {
    const cap = new Set(captured);
    const app = new Set(applied);
    const missing = [...cap].filter((m) => !app.has(m));
    const extra = [...app].filter((m) => !cap.has(m));
    if (missing.length > 0 || extra.length > 0) {
        throw new Error(
            `db-snapshot restore: migration set mismatch — ` +
                `captured-but-not-applied=${JSON.stringify(missing)} ` +
                `applied-but-not-captured=${JSON.stringify(extra)}. ` +
                `Schema drift between the golden snapshot and the current migrations.`,
        );
    }
}

function openSuper(opts: RestoreOptions['superuser'], database: string): postgres.Sql {
    return postgres({
        host: opts.host,
        port: opts.port,
        database,
        user: opts.user,
        password: opts.password,
        max: 2,
        prepare: false,
        onnotice: () => {},
    });
}

/** Restore the control-plane DB. */
async function restoreControlPlane(
    bundle: SnapshotBundle,
    opts: RestoreOptions,
): Promise<void> {
    const cpSnap = bundle.databases.find((d) => d.kind === 'control-plane');
    if (!cpSnap) throw new Error('db-snapshot restore: bundle has no control-plane database');

    const cp = openSuper(opts.superuser, opts.controlPlaneDatabase);
    try {
        const { applied } = await runMigrations(cp, 'control-plane');
        // The runner only reports NEWLY applied files; the authoritative
        // applied set is the bookkeeping table. Read it back.
        const appliedRows = await cp.unsafe<{ filename: string }[]>(
            `SELECT filename FROM control_plane._migrations ORDER BY filename`,
        );
        void applied;
        assertMigrationSet(cpSnap.migrations, appliedRows.map((r) => r.filename));

        const cols = await liveColumns(cp, 'control_plane');
        const ordered = orderTables(
            rewriteTenantDbNames(cpSnap, opts.tenantDbRename),
            CONTROL_PLANE_INSERT_ORDER,
        );
        await cp.begin(async (tx) => {
            for (const table of ordered) {
                const meta = cols.get(table.table);
                if (!meta) {
                    throw new Error(
                        `db-snapshot restore: control-plane table ${table.table} not found in restored schema`,
                    );
                }
                await insertTableRows(tx, table, meta);
            }
        });
        await resetSequences(cp, 'control_plane');
    } finally {
        await cp.end({ timeout: 5 }).catch(() => {});
    }
}

/**
 * Rewrite the `tenants.db_name` cell for any renamed tenant so the restored
 * control-plane points at the scratch DBs.
 */
function rewriteTenantDbNames(
    cpSnap: DatabaseSnapshot,
    rename?: Record<string, string>,
): TableSnapshot[] {
    if (!rename || Object.keys(rename).length === 0) return cpSnap.tables;
    return cpSnap.tables.map((t) => {
        if (t.table !== 'tenants') return t;
        const tenantIdIdx = t.columns.indexOf('tenant_id');
        const dbNameIdx = t.columns.indexOf('db_name');
        if (tenantIdIdx < 0 || dbNameIdx < 0) return t;
        const rows = t.rows.map((row) => {
            const tid = row[tenantIdIdx];
            if (typeof tid === 'string' && rename[tid]) {
                const copy = [...row];
                copy[dbNameIdx] = rename[tid];
                return copy;
            }
            return row;
        });
        return { ...t, rows };
    });
}

/** Restore a single tenant DB. */
async function restoreTenant(
    snap: DatabaseSnapshot,
    opts: RestoreOptions,
): Promise<void> {
    if (!snap.connection) {
        throw new Error(`db-snapshot restore: tenant ${snap.tenantId} missing connection info`);
    }
    const scratchName = opts.tenantDbRename?.[snap.tenantId ?? ''];
    const superCp = openSuper(opts.superuser, opts.controlPlaneDatabase);
    let dbName: string;
    let role: string;
    try {
        const created = await createTenantDb(superCp, snap.connection, scratchName);
        dbName = created.dbName;
        role = created.role;
    } finally {
        await superCp.end({ timeout: 5 }).catch(() => {});
    }

    // Provisioner connection to the tenant DB (superuser creds, tenant db).
    const tenantSql = openSuper(opts.superuser, dbName);
    try {
        await runMigrations(tenantSql, 'tenant');
        const appliedRows = await tenantSql.unsafe<{ filename: string }[]>(
            `SELECT filename FROM public._migrations ORDER BY filename`,
        );
        assertMigrationSet(snap.migrations, appliedRows.map((r) => r.filename));

        await replayGrants(tenantSql, role);

        const cols = await liveColumns(tenantSql, 'public');
        const ordered = orderTables(snap.tables, TENANT_INSERT_ORDER);
        await tenantSql.begin(async (tx) => {
            for (const table of ordered) {
                const meta = cols.get(table.table);
                if (!meta) {
                    throw new Error(
                        `db-snapshot restore: tenant table ${table.table} not found in restored schema`,
                    );
                }
                await insertTableRows(tx, table, meta);
            }
        });
        await resetSequences(tenantSql, 'public');
    } finally {
        await tenantSql.end({ timeout: 5 }).catch(() => {});
    }
}

/** Orchestrate a full restore of `bundle`. */
export async function restoreBundle(bundle: SnapshotBundle, opts: RestoreOptions): Promise<void> {
    await restoreControlPlane(bundle, opts);
    if (opts.controlPlaneOnly) return;
    for (const db of bundle.databases) {
        if (db.kind !== 'tenant') continue;
        await restoreTenant(db, opts);
    }
}

// Keep `metaFromSnapshot` referenced so lint doesn't flag it; it documents the
// snapshot→meta shape even though restore reads live metadata.
void metaFromSnapshot;
