/**
 * Out-of-band migration runner — integration test.
 *
 * @spec specs/domains/runtime/capabilities/out-of-band-migration/README.md
 * @spec I20 — operator feature delivery without a restart (the wipe→reseed
 *   cycle reaches a migrated state WITHOUT booting apps/server).
 *
 * Proves the fork-(a) acceptance bar from the capability README:
 *
 *   - Out-of-band re-apply (load-bearing): against a freshly-created/empty
 *     control-plane DB, `runOutOfBandMigrations` applies the full control-
 *     plane migration set and the `control_plane._migrations` filename set
 *     afterward equals the bundled `.sql` files in
 *     `adapters/node/src/migrations/control-plane/` — with NO apps/server
 *     boot in this test process.
 *   - Idempotency: a second run applies zero additional migrations.
 *
 * SHARED-CONTAINER HYGIENE (ticket constraint): this test operates on a
 * SCRATCH control-plane DB (`oob_migrate_test`) ONLY. It NEVER touches the
 * live `control_plane` or any `atlas_t_*` DB, and it NEVER bounces/restarts
 * the Postgres container. Every pool it opens is closed in `afterAll`.
 *
 * Skipped silently when no Postgres superuser is reachable — mirrors the
 * `@atlas/adapter-node` and `tools/db-snapshot` suites so CI without a DB
 * still passes.
 *
 * Mirrors the scratch-DB lifecycle of
 * `tools/db-snapshot/test/round-trip.test.ts`.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from '@atlas/test';
import { PostgresTenantDbProvider } from '../adapters/node/src/index.ts';
import { runOutOfBandMigrations } from './migrate.ts';

const ADMIN_URL =
  process.env['DB_SNAPSHOT_TEST_DB_URL'] ??
  process.env['CONTROL_PLANE_DB_URL'] ??
  'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

const SCRATCH_DB = 'oob_migrate_test';
// A tenant provisioned INSIDE the scratch control-plane DB so the fan-out
// has a real per-tenant DB to migrate. Slug → derived db/role names.
const FANOUT_TENANT = 'oobfan';
const FANOUT_DB = 'atlas_t_oobfan';
const FANOUT_ROLE = 'atlas_t_oobfan_runtime';
// A tenant row whose db_* coordinates point at a DB that does NOT exist —
// simulates a DB dropped out-of-band while the row survives. The runner must
// skip it (collecting the error) rather than aborting the whole run.
const ORPHAN_TENANT = 'ooborphan';
const ORPHAN_DB = 'atlas_t_ooborphan_missing';

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

const su = parse(ADMIN_URL);

/** Connection URL pointed at the scratch control-plane DB. */
function scratchUrl(): string {
  return `postgres://${encodeURIComponent(su.user)}:${encodeURIComponent(su.password)}@${su.host}:${su.port}/${SCRATCH_DB}`;
}

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

/** Drop a scratch database, terminating any open backends first. */
async function dropDb(admin: postgres.Sql, name: string): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe scratch db name ${name}`);
  await admin
    .unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    )
    .catch(() => {});
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`).catch(() => {});
}

/** The bundled control-plane migration filename set. */
async function bundledControlPlaneFiles(): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', 'adapters', 'node', 'src', 'migrations', 'control-plane');
  const all = await readdir(dir);
  return all.filter((f) => f.toLowerCase().endsWith('.sql')).sort((a, b) => a.localeCompare(b));
}

let HAS_DB = false;

describe('out-of-band migration runner (scratch control-plane DB, no server boot)', () => {
  beforeAll(async () => {
    HAS_DB = await reachable();
    if (!HAS_DB) return;
    // Fresh, empty scratch control-plane DB. NEVER the live control_plane.
    const admin = postgres({ ...su, max: 1, prepare: false, onnotice: () => {} });
    try {
      await dropDb(admin, SCRATCH_DB);
      await admin.unsafe(`CREATE DATABASE "${SCRATCH_DB}"`);
    } finally {
      await admin.end({ timeout: 2 }).catch(() => {});
    }
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const admin = postgres({ ...su, max: 1, prepare: false, onnotice: () => {} });
    try {
      // Drop the fan-out tenant DB + role, then the scratch CP. The role is a
      // cluster-level object; clean it up so reruns start from a known state.
      await dropDb(admin, FANOUT_DB);
      await admin.unsafe(`DROP ROLE IF EXISTS "${FANOUT_ROLE}"`).catch(() => {});
      await dropDb(admin, SCRATCH_DB);
    } finally {
      await admin.end({ timeout: 2 }).catch(() => {});
    }
  });

  it('applies the full control-plane migration set to an empty DB without booting apps/server', async () => {
    if (!HAS_DB) return; // silent skip — matches sibling suites

    const result = await runOutOfBandMigrations({ controlPlaneDbUrl: scratchUrl() });

    const bundled = await bundledControlPlaneFiles();

    // The runner reports the full set as applied on a fresh DB.
    expect(result.controlPlane.applied).toEqual(bundled);

    // And the on-disk bookkeeping matches the bundled set exactly.
    const sql = postgres(scratchUrl(), { max: 1, prepare: false, onnotice: () => {} });
    try {
      const rows = await sql.unsafe<{ filename: string }[]>(
        `SELECT filename FROM control_plane._migrations ORDER BY filename`,
      );
      expect(rows.map((r) => r.filename)).toEqual(bundled);

      // Sanity: a representative control-plane table exists.
      const tables = await sql.unsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'control_plane' AND table_type = 'BASE TABLE'`,
      );
      const names = new Set(tables.map((t) => t.table_name));
      expect(names.has('tenants')).toBe(true);
    } finally {
      await sql.end({ timeout: 2 }).catch(() => {});
    }
  });

  it('is idempotent — a second run applies zero additional control-plane migrations', async () => {
    if (!HAS_DB) return;

    const second = await runOutOfBandMigrations({ controlPlaneDbUrl: scratchUrl() });
    expect(second.controlPlane.applied).toEqual([]);
  });

  it('fans out to a provisioned tenant DB, migrating it as the provisioner identity', async () => {
    if (!HAS_DB) return;

    // Provision a real per-tenant DB inside the scratch control-plane. This
    // creates atlas_t_oobfan + the CRUD-only runtime role and populates the
    // tenants.db_* coordinates — the exact shape the fan-out enumerates.
    const cpSql = postgres(scratchUrl(), { max: 2, prepare: false, onnotice: () => {} });
    // Clean any leftover DB/role from a prior run so provisioning is fresh.
    {
      const admin = postgres({ ...su, max: 1, prepare: false, onnotice: () => {} });
      try {
        await dropDb(admin, FANOUT_DB);
        await admin.unsafe(`DROP ROLE IF EXISTS "${FANOUT_ROLE}"`).catch(() => {});
      } finally {
        await admin.end({ timeout: 2 }).catch(() => {});
      }
    }
    const provider = new PostgresTenantDbProvider(cpSql);
    try {
      await cpSql`
        INSERT INTO control_plane.tenants (tenant_id, name, status)
        VALUES (${FANOUT_TENANT}, 'OOB Fanout', 'active')
        ON CONFLICT (tenant_id) DO NOTHING
      `;
      await provider.provisionTenantDatabase({ tenantId: FANOUT_TENANT, name: 'OOB Fanout' });
    } finally {
      await provider.close();
      await cpSql.end({ timeout: 2 }).catch(() => {});
    }

    // Now run the out-of-band migrator. The tenant DB was already migrated by
    // the provisioner, so the fan-out should report it current (zero applied)
    // — proving the fan-out connects with DDL-capable (provisioner) creds,
    // NOT the CRUD-only runtime role, and reaches the right DB.
    const result = await runOutOfBandMigrations({ controlPlaneDbUrl: scratchUrl() });

    expect(result.failedTenants).toBe(0);
    const fan = result.tenants.find((t) => t.tenantId === FANOUT_TENANT);
    expect(fan).toBeDefined();
    expect(fan?.error).toBeUndefined();
    expect(fan?.applied).toEqual([]);

    // And the tenant DB carries the tenant migration bookkeeping.
    const tenantSql = postgres(
      `postgres://${encodeURIComponent(su.user)}:${encodeURIComponent(su.password)}@${su.host}:${su.port}/${FANOUT_DB}`,
      { max: 1, prepare: false, onnotice: () => {} },
    );
    try {
      const rows = await tenantSql.unsafe<{ filename: string }[]>(
        `SELECT filename FROM public._migrations ORDER BY filename`,
      );
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await tenantSql.end({ timeout: 2 }).catch(() => {});
    }
  });

  it('skips a tenant whose DB was dropped out-of-band and continues (collects the error)', async () => {
    if (!HAS_DB) return;

    // Insert a tenants row with db_* coordinates pointing at a non-existent
    // DB — the realistic "DB dropped, row survived" condition observed against
    // the live control-plane. The runner must NOT abort; it records the error
    // and keeps going (the already-provisioned fan-out tenant still succeeds).
    const cpSql = postgres(scratchUrl(), { max: 1, prepare: false, onnotice: () => {} });
    try {
      await cpSql`
        INSERT INTO control_plane.tenants
          (tenant_id, name, status, db_host, db_port, db_name, db_user, db_password)
        VALUES (${ORPHAN_TENANT}, 'OOB Orphan', 'active',
                ${su.host}, ${su.port}, ${ORPHAN_DB}, ${su.user}, ${su.password})
        ON CONFLICT (tenant_id) DO UPDATE
          SET db_host = EXCLUDED.db_host, db_port = EXCLUDED.db_port,
              db_name = EXCLUDED.db_name, db_user = EXCLUDED.db_user,
              db_password = EXCLUDED.db_password
      `;
    } finally {
      await cpSql.end({ timeout: 2 }).catch(() => {});
    }

    const result = await runOutOfBandMigrations({ controlPlaneDbUrl: scratchUrl() });

    // Control-plane still current; orphan recorded as failed; the run did not throw.
    expect(result.controlPlane.applied).toEqual([]);
    expect(result.failedTenants).toBeGreaterThanOrEqual(1);
    const orphan = result.tenants.find((t) => t.tenantId === ORPHAN_TENANT);
    expect(orphan).toBeDefined();
    expect(orphan?.error).toMatch(/does not exist/i);
    // The healthy fan-out tenant provisioned earlier still migrated cleanly.
    const fan = result.tenants.find((t) => t.tenantId === FANOUT_TENANT);
    expect(fan?.error).toBeUndefined();
  });

  it('refuses a non-loopback control-plane DB URL (operator-laptop guard)', async () => {
    await expect(
      runOutOfBandMigrations({
        controlPlaneDbUrl: 'postgres://u:p@db.production.example.com:5432/control_plane',
      }),
    ).rejects.toThrow(/loopback/i);
  });

  // Acceptance §"make db-migrate is no longer a no-op" — a regression that
  // reverted the recipe to the legacy "start the server" echo would otherwise
  // pass the whole suite. No DB required; reads the Makefile directly.
  it('make db-migrate invokes the runner, not the legacy echo', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const makefile = await readFile(join(here, '..', 'Makefile'), 'utf8');
    // Extract the db-migrate recipe: from the last `db-migrate:` target line
    // through the following tab-indented recipe lines.
    const lines = makefile.split('\n');
    const targetIdx = lines.findLastIndex((l) => /^db-migrate:/.test(l));
    expect(targetIdx, 'db-migrate target present').toBeGreaterThanOrEqual(0);
    const recipe: string[] = [];
    for (let i = targetIdx + 1; i < lines.length; i += 1) {
      const l = lines[i] ?? '';
      if (l.startsWith('\t') || l.trim() === '' || l.startsWith('\t@')) {
        recipe.push(l);
        continue;
      }
      if (/^[A-Za-z0-9_.-]+:/.test(l)) break; // next target
    }
    const body = recipe.join('\n');
    expect(body, 'db-migrate recipe runs the out-of-band runner').toContain('scripts/migrate.ts');
    expect(body, 'legacy "start the server" echo is gone').not.toMatch(/start the server/i);
  });
});
