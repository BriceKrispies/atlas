/**
 * Round-trip integration test.
 *
 * capture (LIVE control_plane, READ-ONLY)
 *   → restore into SCRATCH databases (scratch CP + scratch tenant DBs)
 *   → re-capture the scratch topology
 *   → diff
 *   → assert zero diffs (modulo the documented exclusion set).
 *
 * Scratch isolation: NEVER touches the live `control_plane` or any live
 * `atlas_t_*` DB. The scratch CP is `db_snapshot_test_cp`; each tenant DB is
 * renamed to `db_snapshot_test_t_<n>`. Roles are reused (verbatim password) —
 * they already exist from the live provisioning, so createTenantDb takes the
 * ALTER ROLE path (idempotent, password unchanged since it's the captured one).
 *
 * Skipped unless a Postgres superuser is reachable. Set
 *   DB_SNAPSHOT_TEST_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/control_plane
 * (defaults to the standard make db-up URL).
 *
 * Teardown drops every scratch database and closes pools.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from '@atlas/test';
import { captureTopology } from '../src/capture.ts';
import { diffBundle } from '../src/diff.ts';
import { restoreBundle } from '../src/restore.ts';
import type { SnapshotBundle } from '../src/types.ts';

const DB_URL =
    process.env['DB_SNAPSHOT_TEST_DB_URL'] ??
    'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

const SCRATCH_CP = 'db_snapshot_test_cp';

function parse(url: string): {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
} {
    const u = new URL(url);
    return {
        host: u.hostname,
        port: u.port ? Number.parseInt(u.port, 10) : 5432,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.replace(/^\//, ''),
    };
}

const su = parse(DB_URL);

async function reachable(): Promise<boolean> {
    const sql = postgres({ ...su, max: 1, prepare: false, onnotice: () => {} });
    try {
        await sql`SELECT 1`;
        return true;
    } catch {
        return false;
    } finally {
        await sql.end({ timeout: 1 }).catch(() => {});
    }
}

let HAS_DB = false;

/** Drop a scratch database, terminating any open backends first. */
async function dropDb(admin: postgres.Sql, name: string): Promise<void> {
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe scratch db name ${name}`);
    await admin.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    ).catch(() => {});
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`).catch(() => {});
}

let golden: SnapshotBundle;
let rename: Record<string, string> = {};
let scratchTenantDbs: string[] = [];

describe('db-snapshot round-trip (capture → restore scratch → re-capture → diff)', () => {
    beforeAll(async () => {
        HAS_DB = await reachable();
        if (!HAS_DB) return;

        // 1. Capture the LIVE topology (READ-ONLY).
        golden = await captureTopology(su);

        // 2. Allocate scratch names per tenant; build the rename map.
        const tenantSnaps = golden.databases.filter((d) => d.kind === 'tenant');
        rename = {};
        scratchTenantDbs = [];
        tenantSnaps.forEach((d, i) => {
            const scratch = `db_snapshot_test_t_${i}`;
            rename[d.tenantId!] = scratch;
            scratchTenantDbs.push(scratch);
        });

        // 3. Fresh scratch CP DB.
        const admin = postgres({ ...su, max: 1, prepare: false, onnotice: () => {} });
        try {
            await dropDb(admin, SCRATCH_CP);
            for (const d of scratchTenantDbs) await dropDb(admin, d);
            await admin.unsafe(`CREATE DATABASE "${SCRATCH_CP}"`);
        } finally {
            await admin.end({ timeout: 2 }).catch(() => {});
        }

        // 4. Restore into scratch (control-plane → scratch CP; tenants → scratch DBs).
        await restoreBundle(golden, {
            superuser: { host: su.host, port: su.port, user: su.user, password: su.password },
            controlPlaneDatabase: SCRATCH_CP,
            tenantDbRename: rename,
        });
    });

    afterAll(async () => {
        if (!HAS_DB) return;
        const admin = postgres({ ...su, max: 1, prepare: false, onnotice: () => {} });
        try {
            for (const d of scratchTenantDbs) await dropDb(admin, d);
            await dropDb(admin, SCRATCH_CP);
        } finally {
            await admin.end({ timeout: 2 }).catch(() => {});
        }
    });

    it('re-capturing the scratch topology yields zero diffs vs golden', async () => {
        if (!HAS_DB) {
            // Silently skip when no Postgres — mirrors the adapter-node suite.
            return;
        }

        // Re-capture the scratch topology (scratch CP + scratch tenant DBs).
        const actual = await captureTopology({ ...su, database: SCRATCH_CP });

        // The captured control_plane.tenants.db_name cells differ because we
        // rewrote them to scratch names on restore. Apply the SAME rewrite to
        // golden so the comparison is apples-to-apples — every OTHER cell must
        // match verbatim (db_password, timestamps, seq, jsonb, …).
        const goldenAdjusted = applyTenantDbRename(golden, rename);

        const diffs = diffBundle(goldenAdjusted, actual);
        if (diffs.length > 0) {
            // Surface the first few for a debuggable failure message.
            const sample = diffs
                .slice(0, 10)
                .map((d) => `[${d.kind}] ${d.database} ${d.table}: ${d.detail}`)
                .join('\n');
            throw new Error(`expected zero diffs, got ${diffs.length}:\n${sample}`);
        }
        expect(diffs).toEqual([]);
    });
});

/** Rewrite golden's tenants.db_name cells to the scratch names (and connection.dbName). */
function applyTenantDbRename(
    bundle: SnapshotBundle,
    renameMap: Record<string, string>,
): SnapshotBundle {
    return {
        capturedAt: bundle.capturedAt,
        databases: bundle.databases.map((d) => {
            if (d.kind === 'control-plane') {
                return {
                    ...d,
                    tables: d.tables.map((t) => {
                        if (t.table !== 'tenants') return t;
                        const tidIdx = t.columns.indexOf('tenant_id');
                        const dbNameIdx = t.columns.indexOf('db_name');
                        if (tidIdx < 0 || dbNameIdx < 0) return t;
                        return {
                            ...t,
                            rows: t.rows.map((row) => {
                                const tid = row[tidIdx];
                                if (typeof tid === 'string' && renameMap[tid]) {
                                    const copy = [...row];
                                    copy[dbNameIdx] = renameMap[tid];
                                    return copy;
                                }
                                return row;
                            }),
                        };
                    }),
                };
            }
            return d;
        }),
    };
}
