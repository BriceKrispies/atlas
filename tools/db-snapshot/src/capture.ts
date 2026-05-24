/**
 * Capture — read a live database (READ-ONLY) into a `SnapshotBundle`.
 *
 * Per table: `SELECT <ordinal columns> FROM <schema>.<table> ORDER BY <pk>`.
 * No writes. No DDL. Pools are opened with `max: 2` and closed in `finally`.
 *
 * The control-plane DB and every provisioned tenant DB are captured into one
 * bundle. Tenant connection coordinates (incl. the verbatim db_password) are
 * recorded so restore can recreate the role exactly.
 */
import postgres from 'postgres';
import type {
    ColumnMeta,
    DatabaseSnapshot,
    SnapshotBundle,
    TableMeta,
    TableSnapshot,
} from './types.ts';
import {
    CONTROL_PLANE_SCHEMAS,
    TENANT_SCHEMAS,
    enumerateSchema,
    listProvisionedTenants,
    readMigrationSet,
} from './enumerate.ts';
import { encodeRow } from './encode.ts';

/** Quote a Postgres identifier defensively (capture builds raw SQL). */
function quoteIdent(ident: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(ident)) {
        throw new Error(`db-snapshot capture: refusing to quote unsafe identifier: ${ident}`);
    }
    return `"${ident}"`;
}

/** Build the ordinal column SELECT list. */
function selectList(columns: ColumnMeta[]): string {
    return columns.map((c) => quoteIdent(c.name)).join(', ');
}

/** Build a deterministic ORDER BY from the primary key (falls back to all cols). */
function orderByClause(meta: TableMeta): string {
    const cols = meta.primaryKey.length > 0 ? meta.primaryKey : meta.columns.map((c) => c.name);
    return cols.map((c) => quoteIdent(c)).join(', ');
}

/**
 * Capture a single table READ-ONLY into a `TableSnapshot`.
 */
export async function captureTable(sql: postgres.Sql, meta: TableMeta): Promise<TableSnapshot> {
    const cols = selectList(meta.columns);
    const order = orderByClause(meta);
    const fqtn = `${quoteIdent(meta.schema)}.${quoteIdent(meta.table)}`;
    // `.values()` returns row arrays (positional) rather than objects — exactly
    // the ordinal alignment we want, and avoids object-key reordering surprises.
    const rawRows = await sql
        .unsafe(`SELECT ${cols} FROM ${fqtn} ORDER BY ${order}`)
        .values();
    const rows = (rawRows as unknown[][]).map((r) => encodeRow(r, meta.columns));
    return {
        table: meta.table,
        schema: meta.schema,
        columns: meta.columns.map((c) => c.name),
        rows,
        rowCount: rows.length,
    };
}

/**
 * Capture every table in a database (one open pool) READ-ONLY.
 */
export async function captureDatabase(
    sql: postgres.Sql,
    database: string,
    kind: 'control-plane' | 'tenant',
    opts: { tenantId?: string; connection?: DatabaseSnapshot['connection'] } = {},
): Promise<DatabaseSnapshot> {
    const schemas = kind === 'control-plane' ? CONTROL_PLANE_SCHEMAS : TENANT_SCHEMAS;
    const metas = await enumerateSchema(sql, schemas);
    const tables: TableSnapshot[] = [];
    for (const meta of metas) {
        tables.push(await captureTable(sql, meta));
    }
    const migrations = await readMigrationSet(sql, kind);
    const snapshot: DatabaseSnapshot = {
        database,
        kind,
        migrations,
        tables,
    };
    if (opts.tenantId !== undefined) snapshot.tenantId = opts.tenantId;
    if (opts.connection !== undefined) snapshot.connection = opts.connection;
    return snapshot;
}

/**
 * Open a READ-ONLY pool to a database. `max: 2`, prepare:false to match the
 * project's test posture.
 */
function openPool(info: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
}): postgres.Sql {
    return postgres({
        host: info.host,
        port: info.port,
        database: info.database,
        user: info.user,
        password: info.password,
        max: 2,
        prepare: false,
        onnotice: () => {
            /* swallow */
        },
    });
}

/**
 * Capture the full Atlas topology: control-plane + every provisioned tenant DB.
 *
 * `controlInfo` is the privileged connection (superuser) used both to read
 * `control_plane` and — because tenant runtime roles are CRUD-only and the
 * superuser can read every DB — to read each tenant DB. We connect to each
 * tenant DB as the SUPERUSER (same host/port/user/password as control, just a
 * different `database`) so capture sees all tables regardless of grants.
 */
export async function captureTopology(controlInfo: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}): Promise<SnapshotBundle> {
    const capturedAt = new Date().toISOString();
    const databases: DatabaseSnapshot[] = [];

    const controlSql = openPool(controlInfo);
    let tenants: Awaited<ReturnType<typeof listProvisionedTenants>>;
    try {
        databases.push(
            await captureDatabase(controlSql, controlInfo.database, 'control-plane'),
        );
        tenants = await listProvisionedTenants(controlSql);
    } finally {
        await controlSql.end({ timeout: 5 }).catch(() => {});
    }

    const skipped: { tenantId: string; dbName: string; reason: string }[] = [];
    for (const t of tenants) {
        // Connect to the tenant DB as the superuser (control creds) so capture
        // is not limited by the CRUD-only runtime grants.
        const tenantSql = openPool({
            host: controlInfo.host,
            port: controlInfo.port,
            database: t.dbName,
            user: controlInfo.user,
            password: controlInfo.password,
        });
        try {
            databases.push(
                await captureDatabase(tenantSql, t.dbName, 'tenant', {
                    tenantId: t.tenantId,
                    connection: {
                        dbHost: t.dbHost,
                        dbPort: t.dbPort,
                        dbName: t.dbName,
                        dbUser: t.dbUser,
                        dbPassword: t.dbPassword,
                    },
                }),
            );
        } catch (e) {
            // A tenants row may point at a db that no longer exists (stale
            // control-plane state — e.g. a dropped scratch DB whose row was
            // never cleaned up). Capture is best-effort across tenants: skip
            // the unreachable DB and record it rather than aborting the whole
            // snapshot. `3D000` = invalid_catalog_name (database does not exist).
            const code = (e as { code?: string }).code;
            if (code === '3D000') {
                skipped.push({ tenantId: t.tenantId, dbName: t.dbName, reason: 'database does not exist' });
            } else {
                throw e;
            }
        } finally {
            await tenantSql.end({ timeout: 5 }).catch(() => {});
        }
    }
    if (skipped.length > 0) {
        process.stderr.write(
            `db-snapshot capture: skipped ${skipped.length} tenant DB(s) with stale ` +
                `control-plane rows: ${skipped.map((s) => `${s.tenantId}(${s.dbName})`).join(', ')}\n`,
        );
    }

    return { capturedAt, databases };
}
