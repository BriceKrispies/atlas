#!/usr/bin/env node
/**
 * dev-up — one-command bring-up of the Atlas dev data plane.
 *
 * Specced in `specs/decisions/0015-dev-mode-contract.md` §5. After this
 * script returns successfully the following are true:
 *
 *   1. The control-plane DB is reachable on the configured URL and its
 *      migrations are applied.
 *   2. The `_platform` tenant row exists, its tenant-DB migrations are
 *      applied, and a `platform-admin` User + Membership is seeded.
 *   3. A `dev-tenant` row exists in `control_plane.tenants` with
 *      `status='active'`. Its tenant-DB migrations are applied.
 *   4. A `dev-admin` User and matching Membership(role=admin) exist in
 *      `dev-tenant`.
 *
 * Idempotent: re-running yields the same end state with no-op writes for
 * already-seeded rows. ADR 0015 §"Constraints" #5 names this as a hard
 * requirement.
 *
 * Observability: every action emits a structured `DevUp.*` log event via
 * `@atlas/logging` (per specs/crosscut/logging.md). Structured JSON goes
 * to stderr so it can be captured / piped through jq; a friendly
 * human-readable progress line goes to stdout for the operator running
 * the script in a terminal.
 *
 * Usage:
 *   pnpm dev:up
 *   pnpm dev:up 2>dev-up.log   # capture structured events for inspection
 *
 * Env:
 *   CONTROL_PLANE_DB_URL — defaults to the `make db-up` value (loopback).
 *                          Override at your own risk; the script refuses
 *                          to run against non-loopback URLs (ADR §"Constraints" #7).
 */
// NB: relative imports because the root `package.json` doesn't list
// `@atlas/adapter-node` / `@atlas/logging` as workspace devDeps, and
// adding them globally would pull adapter packages into every script's
// import graph. The `scripts/atlas-domain.ts` precedent uses the same
// relative-path trick.
import postgres from 'postgres';
import {
  PostgresEntityStore,
  PostgresTenantDbProvider,
  runMigrations,
} from '../adapters/node/src/index.ts';
import {
  ConsoleJsonSink,
  InMemoryLevelController,
  LogPipeline,
  createSystemContext,
  registerForExitFlush,
  type AtlasExecutionContext,
} from '../packages/logging/src/index.ts';
import {
  PLATFORM_ADMIN_PRINCIPAL_ID,
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_TENANT_ID,
} from '../packages/platform-core/src/index.ts';

const DEV_TENANT_ID = 'dev-tenant';
const DEV_TENANT_NAME = 'Dev Tenant';
const DEV_ADMIN_PRINCIPAL_ID = 'dev-admin';
const DEV_ADMIN_EMAIL = 'dev-admin@dev-tenant.local';
const DEV_ADMIN_DISPLAY_NAME = 'Dev Admin';
const DEV_ADMIN_ROLE = 'admin';

const DEFAULT_DB_URL =
  'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';

/** Friendly progress to stdout for the operator watching the terminal. */
function progress(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Loopback-only guard, mirroring `config.ts` `validateDevMode()` guard
 * #3. The script writes admin credentials into the DB; refusing
 * non-loopback URLs prevents a misclicked env var from seeding a
 * production cluster.
 */
function assertLoopback(dbUrl: string): { ok: true } | { ok: false; reason: string } {
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
        `refusing to seed against non-loopback control-plane DB host '${host}'. ` +
        `dev-up is a developer-laptop tool.`,
    };
  }
  return { ok: true };
}

/**
 * `INSERT … ON CONFLICT DO NOTHING` for a tenant row. Returns `true`
 * if a row was actually inserted, `false` if it already existed.
 */
async function ensureTenantRow(
  sql: postgres.Sql,
  tenantId: string,
  name: string,
): Promise<boolean> {
  const inserted = await sql<{ tenant_id: string }[]>`
    INSERT INTO control_plane.tenants (tenant_id, name, status, region)
    VALUES (${tenantId}, ${name}, 'active', NULL)
    ON CONFLICT (tenant_id) DO NOTHING
    RETURNING tenant_id
  `;
  return inserted.length > 0;
}

/**
 * Seed a `User` + matching `Membership` in a tenant. Uses
 * `entities.get` to skip the write when the User already exists — the
 * same shape as `bootstrap-platform-admin.ts`. Returns `true` if a row
 * was actually inserted.
 */
async function ensureUserAndMembership(
  entities: PostgresEntityStore,
  args: {
    tenantId: string;
    principalId: string;
    email: string;
    displayName: string;
    roles: string[];
  },
): Promise<boolean> {
  const existing = await entities.get(args.tenantId, 'User', args.principalId);
  if (existing) return false;

  await entities.put({
    tenantId: args.tenantId,
    entityType: 'User',
    entityId: args.principalId,
    attrs: {
      email: args.email,
      displayName: args.displayName,
      status: 'active',
    },
  });

  await entities.put({
    tenantId: args.tenantId,
    entityType: 'Membership',
    entityId: `membership:${args.principalId}`,
    attrs: {
      userId: args.principalId,
      tenantId: args.tenantId,
      roles: args.roles,
      status: 'active',
    },
  });
  return true;
}

/**
 * Build the system-context logger for the script. Structured events go to
 * stderr via ConsoleJsonSink so stdout stays clean for operator-facing
 * progress.
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
    moduleId: 'scripts/dev-up',
  });
  return { ctx, pipeline };
}

async function main(): Promise<void> {
  const { ctx, pipeline } = buildLogger();
  const dbUrl = process.env['CONTROL_PLANE_DB_URL'] ?? DEFAULT_DB_URL;
  const startedAt = Date.now();

  ctx.logger.info('dev-up started', {
    event: 'DevUp.Started',
    properties: { controlPlaneDbUrl: dbUrl },
  });
  progress('▸ atlas dev-up');
  progress(`  control-plane: ${dbUrl}`);
  progress('');

  // Loopback guard. Refuses non-laptop targets.
  const loopback = assertLoopback(dbUrl);
  if (!loopback.ok) {
    ctx.logger.error('dev-up loopback guard failed', {
      event: 'DevUp.LoopbackGuard.Failed',
      properties: { reason: loopback.reason },
    });
    process.stderr.write(`\n✗ dev-up failed: ${loopback.reason}\n\n`);
    pipeline.flushSync();
    process.exit(1);
  }
  ctx.logger.info('loopback guard passed', { event: 'DevUp.LoopbackGuard.Passed' });

  // Suppress postgres NOTICE side-output ("schema already exists, skipping"
  // etc.) — these are not structured events, they're library chatter that
  // leaks onto stdout and muddles the operator-facing progress.
  const controlSql = postgres(dbUrl, { max: 2, onnotice: function () {} });

  try {
    // 1. Probe.
    try {
      await controlSql`SELECT 1`;
      ctx.logger.info('control-plane reachable', {
        event: 'DevUp.ControlPlaneProbe.Ok',
      });
      progress('  ✔ control-plane DB reachable');
    } catch (e) {
      ctx.logger.error('control-plane probe failed', {
        event: 'DevUp.ControlPlaneProbe.Failed',
        error: {
          code: 'CONTROL_PLANE_UNREACHABLE',
          message: e instanceof Error ? e.message : String(e),
        },
      });
      process.stderr.write(
        `\n✗ dev-up failed: cannot reach control-plane DB at ${dbUrl}\n` +
          `  cause: ${(e as Error).message}\n` +
          `  hint:  run \`make db-up\` first\n\n`,
      );
      pipeline.flushSync();
      process.exit(1);
    }

    // 2. Control-plane migrations.
    await runMigrations(controlSql, 'control-plane');
    ctx.logger.info('control-plane migrations applied', {
      event: 'DevUp.ControlPlaneMigrations.Applied',
    });
    progress('  ✔ control-plane migrations applied');

    // ADR 0005 commits to db-per-tenant; the provider is fail-closed
    // (phase 3 removed the shared-DB fallback). After
    // `provisionTenantDatabase` runs for every dev tenant, the
    // `control_plane.tenants.db_*` columns are populated and `getPool`
    // resolves directly to the per-tenant DB.
    const tenantDb = new PostgresTenantDbProvider(controlSql);
    try {
      // 3. Platform tenant row + db provisioning + platform-admin seed.
      //    The row INSERT has to happen BEFORE `provisionTenantDatabase`
      //    because the provisioner UPDATEs `control_plane.tenants.db_*` —
      //    the row must already exist.
      const platformInserted = await ensureTenantRow(
        controlSql,
        PLATFORM_TENANT_ID,
        'Atlas Platform',
      );
      ctx.logger.info('platform-tenant row reconciled', {
        event: 'DevUp.PlatformTenant.RowReconciled',
        properties: { tenantId: PLATFORM_TENANT_ID, inserted: platformInserted },
      });
      progress(
        platformInserted
          ? `  ✔ ${PLATFORM_TENANT_ID} row inserted`
          : `  · ${PLATFORM_TENANT_ID} row already present`,
      );

      // 4. Provision the per-tenant database. Creates `atlas_t__platform`,
      //    the `atlas_t__platform_runtime` role, applies tenant migrations,
      //    and UPDATEs `db_host/db_port/db_name/db_user/db_password` on
      //    the tenants row. Idempotent — re-runs return `created: false`
      //    and emit no `Tenancy.Database.Provisioned` event.
      const platformProvisioned = await tenantDb.provisionTenantDatabase({
        tenantId: PLATFORM_TENANT_ID,
        name: 'Atlas Platform',
      });
      if (platformProvisioned.created) {
        ctx.logger.info('platform tenant database provisioned', {
          event: 'DevUp.PlatformDatabase.Provisioned',
          properties: {
            tenantId: PLATFORM_TENANT_ID,
            dbName: platformProvisioned.dbName,
            runtimeRole: platformProvisioned.runtimeRole,
          },
        });
        progress(
          `  ✔ ${PLATFORM_TENANT_ID} database created (${platformProvisioned.dbName})`,
        );
      } else {
        ctx.logger.info('platform tenant database reconciled', {
          event: 'DevUp.PlatformDatabase.Reconciled',
          properties: {
            tenantId: PLATFORM_TENANT_ID,
            dbName: platformProvisioned.dbName,
            runtimeRole: platformProvisioned.runtimeRole,
          },
        });
        progress(
          `  · ${PLATFORM_TENANT_ID} database already present (${platformProvisioned.dbName})`,
        );
      }

      // 5. Seed `platform-admin` into the per-tenant DB. `getPool` now
      //    resolves to `atlas_t__platform` because the `db_*` columns are
      //    populated (either just now or on a prior run).
      const platformSql = await tenantDb.getPool(PLATFORM_TENANT_ID);
      const platformEntities = new PostgresEntityStore(platformSql);
      const platformSeeded = await ensureUserAndMembership(platformEntities, {
        tenantId: PLATFORM_TENANT_ID,
        principalId: PLATFORM_ADMIN_PRINCIPAL_ID,
        email: PLATFORM_ADMIN_EMAIL,
        displayName: 'Platform Admin',
        roles: ['admin'],
      });
      ctx.logger.info('platform-admin reconciled', {
        event: 'DevUp.PlatformAdmin.Reconciled',
        properties: {
          tenantId: PLATFORM_TENANT_ID,
          principalId: PLATFORM_ADMIN_PRINCIPAL_ID,
          seeded: platformSeeded,
        },
      });
      progress(
        platformSeeded
          ? `  ✔ ${PLATFORM_ADMIN_PRINCIPAL_ID}@${PLATFORM_TENANT_ID} seeded`
          : `  · ${PLATFORM_ADMIN_PRINCIPAL_ID}@${PLATFORM_TENANT_ID} already present`,
      );

      // 6. Same shape for the dev tenant.
      const devInserted = await ensureTenantRow(
        controlSql,
        DEV_TENANT_ID,
        DEV_TENANT_NAME,
      );
      ctx.logger.info('dev-tenant row reconciled', {
        event: 'DevUp.DevTenant.RowReconciled',
        properties: { tenantId: DEV_TENANT_ID, inserted: devInserted },
      });
      progress(
        devInserted
          ? `  ✔ ${DEV_TENANT_ID} row inserted`
          : `  · ${DEV_TENANT_ID} row already present`,
      );

      const devProvisioned = await tenantDb.provisionTenantDatabase({
        tenantId: DEV_TENANT_ID,
        name: DEV_TENANT_NAME,
      });
      if (devProvisioned.created) {
        ctx.logger.info('dev tenant database provisioned', {
          event: 'DevUp.DevDatabase.Provisioned',
          properties: {
            tenantId: DEV_TENANT_ID,
            dbName: devProvisioned.dbName,
            runtimeRole: devProvisioned.runtimeRole,
          },
        });
        progress(
          `  ✔ ${DEV_TENANT_ID} database created (${devProvisioned.dbName})`,
        );
      } else {
        ctx.logger.info('dev tenant database reconciled', {
          event: 'DevUp.DevDatabase.Reconciled',
          properties: {
            tenantId: DEV_TENANT_ID,
            dbName: devProvisioned.dbName,
            runtimeRole: devProvisioned.runtimeRole,
          },
        });
        progress(
          `  · ${DEV_TENANT_ID} database already present (${devProvisioned.dbName})`,
        );
      }

      const devSql = await tenantDb.getPool(DEV_TENANT_ID);
      const devEntities = new PostgresEntityStore(devSql);
      const devSeeded = await ensureUserAndMembership(devEntities, {
        tenantId: DEV_TENANT_ID,
        principalId: DEV_ADMIN_PRINCIPAL_ID,
        email: DEV_ADMIN_EMAIL,
        displayName: DEV_ADMIN_DISPLAY_NAME,
        roles: [DEV_ADMIN_ROLE],
      });
      ctx.logger.info('dev-admin reconciled', {
        event: 'DevUp.DevAdmin.Reconciled',
        properties: {
          tenantId: DEV_TENANT_ID,
          principalId: DEV_ADMIN_PRINCIPAL_ID,
          roles: [DEV_ADMIN_ROLE],
          seeded: devSeeded,
        },
      });
      progress(
        devSeeded
          ? `  ✔ ${DEV_ADMIN_PRINCIPAL_ID}@${DEV_TENANT_ID} seeded (role=${DEV_ADMIN_ROLE})`
          : `  · ${DEV_ADMIN_PRINCIPAL_ID}@${DEV_TENANT_ID} already present`,
      );
    } finally {
      await tenantDb.close();
    }

    const elapsedMs = Date.now() - startedAt;
    ctx.logger.info('dev-up completed', {
      event: 'DevUp.Completed',
      properties: { elapsedMs },
    });
    progress('');
    progress('  Next:');
    progress('    Start the server in dev-mode:');
    progress('      ATLAS_DEV_MODE=true TEST_AUTH_ENABLED=true pnpm --filter @atlas/server dev');
    progress('    Open the admin SPA:');
    progress('      pnpm dev   # http://localhost:5173');
    progress('');
    progress('  Unauthenticated requests in dev-mode resolve to:');
    progress(`    principal: ${DEV_ADMIN_PRINCIPAL_ID}`);
    progress(`    tenant:    ${DEV_TENANT_ID}`);
    progress(`    roles:     [${DEV_ADMIN_ROLE}]`);
    progress('');
    progress('  Safety guards: ADR 0015. Production refuses to enable dev-mode.');
    progress('');
  } catch (e) {
    ctx.logger.error('dev-up unexpected failure', {
      event: 'DevUp.Failed',
      error: {
        code: 'DEV_UP_FAILED',
        message: e instanceof Error ? e.message : String(e),
        ...(e instanceof Error && e.stack !== undefined ? { stack: e.stack } : {}),
      },
    });
    process.stderr.write(
      `\n✗ dev-up failed: ${(e as Error).stack ?? (e as Error).message}\n\n`,
    );
    process.exitCode = 1;
  } finally {
    await controlSql.end({ timeout: 5 });
    pipeline.flushSync();
  }
}

main().catch(function (e) {
  process.stderr.write(
    `\n✗ dev-up failed: ${(e as Error).stack ?? (e as Error).message}\n\n`,
  );
  process.exit(1);
});
