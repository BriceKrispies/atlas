#!/usr/bin/env node
/**
 * migrate — out-of-band Atlas schema migration runner.
 *
 * Specced in
 * `specs/domains/runtime/capabilities/out-of-band-migration/README.md`
 * (fork option (a): standalone runner, NO admin endpoint). Closes one of the
 * three always-on §1 violations in the wipe→reseed cycle: re-applying the
 * Atlas schema to a freshly-wiped/empty database WITHOUT booting `apps/server`
 * (I20 — operator feature delivery without a restart).
 *
 * After this script returns successfully:
 *
 *   1. The control-plane DB at `CONTROL_PLANE_DB_URL` has all bundled
 *      control-plane migrations applied (`control_plane._migrations`).
 *   2. Every provisioned tenant (a `control_plane.tenants` row with non-null
 *      `db_*` coordinates) has its tenant-DB migrations applied
 *      (`public._migrations`).
 *
 * Reuses `runMigrations` (`adapters/node/src/migrations/runner.ts`) unchanged
 * — the same idempotent runner `apps/server` boot and tenant provisioning
 * already call. Idempotent by construction: re-running against an
 * already-migrated DB applies zero migrations.
 *
 * Scope (NOT done here):
 *   - Does NOT boot `apps/server` (no HTTP surface — I1-clean, no principal).
 *   - Does NOT seed rows (seeding is `pnpm dev:up` / the snapshot tool's job).
 *     This runner only (re)applies schema migrations.
 *
 * Observability: every action emits a structured `Migrate.*` log event via
 * `@atlas/logging`. Structured JSON goes to stderr; a friendly human-readable
 * progress line goes to stdout — mirrors `scripts/dev-up.ts`.
 *
 * Usage:
 *   pnpm migrate
 *   make db-migrate
 *   pnpm migrate 2>migrate.log   # capture structured events for inspection
 *
 * Env:
 *   CONTROL_PLANE_DB_URL — defaults to the `make db-up` value (loopback).
 *                          The runner refuses non-loopback URLs (operator-
 *                          laptop / dev-CI tool, same trust boundary as
 *                          `make db-up` / `pnpm dev:up`).
 */
// NB: relative imports because the root `package.json` doesn't list
// `@atlas/adapter-node` / `@atlas/logging` as workspace devDeps — the same
// relative-path trick `scripts/dev-up.ts` uses.
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import {
  runMigrations,
  type MigrationRunResult,
} from '../adapters/node/src/index.ts';

interface ProvisionerInfo {
  host: string;
  port: number;
  user: string;
  password: string;
}
import {
  ConsoleJsonSink,
  InMemoryLevelController,
  LogPipeline,
  createSystemContext,
  registerForExitFlush,
  type AtlasExecutionContext,
  type Logger,
} from '../packages/logging/src/index.ts';

const DEFAULT_DB_URL =
  'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

/** Per-tenant migration outcome. */
export interface TenantMigrationResult {
  tenantId: string;
  /** Migrations applied this run. Empty when the tenant failed. */
  applied: string[];
  /**
   * Failure message when this tenant could not be migrated (e.g. its DB was
   * dropped out-of-band but the `control_plane.tenants` row still carries
   * `db_*` coordinates). Absent on success. The run CONTINUES past a failed
   * tenant and surfaces every failure at once; the aggregate `failedTenants`
   * count drives a non-zero CLI exit.
   */
  error?: string;
}

/** Aggregate result of an out-of-band migration run. */
export interface OutOfBandMigrationResult {
  /** Control-plane migration outcome. */
  controlPlane: MigrationRunResult;
  /** Per-tenant outcomes, one per provisioned tenant fanned out to. */
  tenants: TenantMigrationResult[];
  /** Count of tenants whose migration failed (each has `error` set). */
  failedTenants: number;
}

export interface RunOutOfBandMigrationsOptions {
  /** Control-plane connection URL. */
  controlPlaneDbUrl: string;
  /**
   * Optional context-bound logger. When omitted, no structured events are
   * emitted (the `main()` wrapper supplies one for CLI runs).
   */
  logger?: Logger;
  /**
   * Optional friendly-progress sink. When omitted, no operator-facing lines
   * are written. `main()` wires this to stdout.
   */
  progress?: (line: string) => void;
}

/**
 * Loopback-only guard, mirroring `scripts/dev-up.ts` `assertLoopback`. This
 * runner applies DDL to whatever DB it points at; refusing non-loopback URLs
 * prevents a misclicked env var from migrating a production cluster. It is a
 * developer / CI tool, gated by DB-credential + shell access (the same trust
 * boundary `make db-up` / `pnpm dev:up` assume), not by the policy engine.
 */
export function assertLoopback(
  dbUrl: string,
): { ok: true } | { ok: false; reason: string } {
  let host: string;
  try {
    host = new URL(dbUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: `CONTROL_PLANE_DB_URL is not a parseable URL: ${dbUrl}` };
  }
  const isLoopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local');
  if (!isLoopback) {
    return {
      ok: false,
      reason:
        `refusing to migrate against non-loopback control-plane DB host '${host}'. ` +
        `out-of-band migrate is a developer/CI tool.`,
    };
  }
  return { ok: true };
}

/**
 * Enumerate provisioned tenants from `control_plane.tenants` — rows whose
 * `db_*` coordinates are all non-null (i.e. the per-tenant DB exists). The
 * same source `tools/db-snapshot/src/enumerate.ts` uses for its fan-out.
 *
 * We return the per-tenant DB NAME and HOST/PORT, but NOT the stored
 * `db_user`/`db_password`: those credentials are the tenant *runtime* role
 * (`atlas_t_*_runtime`), which is CRUD-only by design (ADR 0005 two-role
 * topology, I16) and CANNOT run DDL — `runMigrations` against it fails with
 * `permission denied for schema public`. Migrations must run as the
 * *provisioner* (the privileged control-plane identity) pointed at the
 * tenant DB, exactly as `tenant-db-provider.ts` Step 5 does. The caller
 * supplies the provisioner credentials.
 */
async function listProvisionedTenants(
  controlSql: postgres.Sql,
): Promise<{ tenantId: string; dbHost: string; dbPort: number; dbName: string }[]> {
  const rows = await controlSql<
    {
      tenant_id: string;
      db_host: string | null;
      db_port: number | null;
      db_name: string | null;
    }[]
  >`
    SELECT tenant_id, db_host, db_port, db_name
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
  }));
}

/**
 * Resolve the provisioner connection coordinates from the control-plane
 * `Sql`. Mirrors `PostgresTenantDbProvider.provisionerInfoFor` — migrations
 * and DDL run under the control-plane (privileged) identity, pointed at the
 * tenant DB. The tenant runtime role is CRUD-only and cannot migrate.
 */
function provisionerInfoFrom(controlSql: postgres.Sql): ProvisionerInfo {
  const opts = (controlSql as unknown as {
    options: {
      host?: string | string[];
      hostname?: string;
      port?: number | number[];
      user?: string;
      username?: string;
      pass?: string;
      password?: string;
    };
  }).options;
  const host = Array.isArray(opts.host) ? opts.host[0] : (opts.host ?? opts.hostname);
  const port = Array.isArray(opts.port) ? opts.port[0] : opts.port;
  const user = opts.user ?? opts.username;
  const password = opts.pass ?? opts.password;
  if (typeof host !== 'string' || host.length === 0) {
    throw new Error('migrate: could not resolve provisioner host from control-plane connection');
  }
  if (typeof port !== 'number' || !Number.isFinite(port)) {
    throw new Error('migrate: could not resolve provisioner port from control-plane connection');
  }
  if (typeof user !== 'string' || user.length === 0) {
    throw new Error('migrate: could not resolve provisioner user from control-plane connection');
  }
  if (typeof password !== 'string') {
    throw new Error('migrate: could not resolve provisioner password from control-plane connection');
  }
  return { host, port, user, password };
}

/**
 * Re-apply Atlas schema migrations out-of-band: control-plane first, then a
 * fan-out to every provisioned tenant DB. Idempotent — re-running applies
 * zero migrations once everything is current.
 *
 * Opens its own control-plane pool and a fresh per-tenant pool for each
 * provisioned tenant; closes ALL of them in `finally` (connection-limit
 * hygiene). Does NOT boot `apps/server` and does NOT seed.
 *
 * Named + exported so unit tests call it directly with an injected URL /
 * logger / progress sink — no env coupling, no subprocess spawn (testability
 * bar).
 */
export async function runOutOfBandMigrations(
  opts: RunOutOfBandMigrationsOptions,
): Promise<OutOfBandMigrationResult> {
  const { controlPlaneDbUrl, logger, progress } = opts;

  const loopback = assertLoopback(controlPlaneDbUrl);
  if (!loopback.ok) {
    logger?.error('out-of-band migrate loopback guard failed', {
      event: 'Migrate.LoopbackGuard.Failed',
      properties: { reason: loopback.reason },
    });
    throw new Error(loopback.reason);
  }
  logger?.info('loopback guard passed', { event: 'Migrate.LoopbackGuard.Passed' });

  // Suppress postgres NOTICE chatter ("schema already exists, skipping") that
  // would otherwise leak onto stdout and muddle operator-facing progress.
  const controlSql = postgres(controlPlaneDbUrl, { max: 2, onnotice: () => {} });
  // Track every per-tenant pool we open so `finally` closes them all
  // (shared-container connection-limit hygiene).
  let tenantPools: postgres.Sql[] = [];

  try {
    // 1. Control-plane migrations.
    const controlPlane = await runMigrations(controlSql, 'control-plane');
    logger?.info('control-plane migrations applied', {
      event: 'Migrate.ControlPlane.Applied',
      properties: { applied: controlPlane.applied, count: controlPlane.applied.length },
    });
    progress?.(
      controlPlane.applied.length > 0
        ? `  ✔ control-plane: applied ${controlPlane.applied.length} migration(s)`
        : `  · control-plane: already current`,
    );

    // 2. Enumerate provisioned tenants and fan out — migrating each as the
    //    PROVISIONER identity (control-plane creds, tenant DB name), since the
    //    stored runtime role is CRUD-only and cannot run DDL.
    const provisioned = await listProvisionedTenants(controlSql);
    const provisioner = provisionerInfoFrom(controlSql);
    logger?.info('provisioned tenants enumerated', {
      event: 'Migrate.Tenants.Enumerated',
      properties: { count: provisioned.length, tenantIds: provisioned.map((t) => t.tenantId) },
    });
    progress?.(`  · ${provisioned.length} provisioned tenant(s) to migrate`);

    const tenants: TenantMigrationResult[] = [];
    let failedTenants = 0;
    for (const tenant of provisioned) {
      const tenantSql = postgres({
        host: provisioner.host,
        port: provisioner.port,
        database: tenant.dbName,
        user: provisioner.user,
        password: provisioner.password,
        max: 2,
        onnotice: () => {},
      });
      tenantPools.push(tenantSql);
      try {
        const result = await runMigrations(tenantSql, 'tenant');
        tenants.push({ tenantId: tenant.tenantId, applied: result.applied });
        logger?.info('tenant migrations applied', {
          event: 'Migrate.Tenant.Applied',
          properties: {
            tenantId: tenant.tenantId,
            applied: result.applied,
            count: result.applied.length,
          },
        });
        progress?.(
          result.applied.length > 0
            ? `  ✔ ${tenant.tenantId}: applied ${result.applied.length} migration(s)`
            : `  · ${tenant.tenantId}: already current`,
        );
      } catch (e) {
        // A tenant failure (e.g. its DB was dropped out-of-band while the
        // tenants row still carries db_* coordinates) does NOT abort the
        // run. Collect the error, keep going, surface every failure at once;
        // the caller exits non-zero via `failedTenants`.
        failedTenants += 1;
        const message = e instanceof Error ? e.message : String(e);
        tenants.push({ tenantId: tenant.tenantId, applied: [], error: message });
        logger?.error('tenant migration failed', {
          event: 'Migrate.Tenant.Failed',
          error: { code: 'TENANT_MIGRATION_FAILED', message },
          properties: { tenantId: tenant.tenantId, dbName: tenant.dbName },
        });
        progress?.(`  ✗ ${tenant.tenantId}: ${message}`);
      }
    }

    return { controlPlane, tenants, failedTenants };
  } finally {
    // Close every pool we opened — control-plane + per-tenant — so the runner
    // never leaks connections (shared-container connection-limit hygiene).
    await Promise.allSettled([
      controlSql.end({ timeout: 5 }),
      ...tenantPools.map((p) => p.end({ timeout: 5 })),
    ]);
    tenantPools = [];
  }
}

/** Friendly progress to stdout for the operator watching the terminal. */
function stdoutProgress(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Build the system-context logger. Structured events go to stderr via
 * ConsoleJsonSink so stdout stays clean for operator-facing progress.
 */
function buildLogger(): { ctx: AtlasExecutionContext; pipeline: LogPipeline } {
  const levelController = new InMemoryLevelController('info');
  const pipeline = new LogPipeline(
    [new ConsoleJsonSink({ stream: process.stderr })],
    levelController,
  );
  registerForExitFlush(pipeline);
  const ctx = createSystemContext({
    pipeline,
    environment: 'development',
    moduleId: 'scripts/migrate',
  });
  return { ctx, pipeline };
}

async function main(): Promise<void> {
  const { ctx, pipeline } = buildLogger();
  const dbUrl = process.env['CONTROL_PLANE_DB_URL'] ?? DEFAULT_DB_URL;
  const startedAt = Date.now();

  ctx.logger.info('out-of-band migrate started', {
    event: 'Migrate.Started',
    properties: { controlPlaneDbUrl: dbUrl },
  });
  stdoutProgress('▸ atlas migrate (out-of-band, no server boot)');
  stdoutProgress(`  control-plane: ${dbUrl}`);
  stdoutProgress('');

  try {
    const result = await runOutOfBandMigrations({
      controlPlaneDbUrl: dbUrl,
      logger: ctx.logger,
      progress: stdoutProgress,
    });

    const elapsedMs = Date.now() - startedAt;
    const succeededTenants = result.tenants.length - result.failedTenants;
    ctx.logger.info('out-of-band migrate completed', {
      event: 'Migrate.Completed',
      properties: {
        elapsedMs,
        controlPlaneApplied: result.controlPlane.applied.length,
        tenantsMigrated: succeededTenants,
        failedTenants: result.failedTenants,
      },
    });
    if (result.failedTenants > 0) {
      // Non-zero exit so CI / the operator notices, but only AFTER every
      // tenant was attempted — failures are already itemised on stdout/stderr.
      process.exitCode = 1;
      stdoutProgress('');
      stdoutProgress(
        `  ✗ migrate finished with ${result.failedTenants} tenant failure(s) (see above)`,
      );
      stdoutProgress('');
      return;
    }
    stdoutProgress('');
    stdoutProgress('  ✔ migrate complete (no server was booted)');
    stdoutProgress('');
  } catch (e) {
    ctx.logger.error('out-of-band migrate failed', {
      event: 'Migrate.Failed',
      error: {
        code: 'MIGRATE_FAILED',
        message: e instanceof Error ? e.message : String(e),
        ...(e instanceof Error && e.stack !== undefined ? { stack: e.stack } : {}),
      },
    });
    process.stderr.write(
      `\n✗ migrate failed: ${(e as Error).stack ?? (e as Error).message}\n\n`,
    );
    process.exitCode = 1;
  } finally {
    pipeline.flushSync();
  }
}

// Only run `main()` when invoked as a script (`node … scripts/migrate.ts`),
// NOT when imported by `scripts/migrate.test.ts`. Compare `import.meta.url`
// against the file URL of the process entrypoint.
const entrypoint = argv[1] !== undefined ? pathToFileURL(argv[1]).href : undefined;
if (entrypoint !== undefined && import.meta.url === entrypoint) {
  main().catch(function (e) {
    process.stderr.write(
      `\n✗ migrate failed: ${(e as Error).stack ?? (e as Error).message}\n\n`,
    );
    process.exit(1);
  });
}
