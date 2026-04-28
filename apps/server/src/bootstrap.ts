/**
 * Bootstrap — wires Postgres pools + adapters at startup.
 *
 * Per-request state (Principal-scoped IngressState) is built later, in the
 * routes themselves, because handlers and the catalog dispatcher need the
 * tenant Sql resolved against the principal that just authenticated. This
 * file constructs only the long-lived pieces:
 *
 * - control-plane Postgres connection
 * - control-plane migrations applied
 * - PostgresTenantDbProvider (LRU pool cache)
 * - PostgresControlPlaneRegistry (action catalog from bundled manifest)
 * - JWKS remote, lazily initialised on first verification
 *
 * Tenant migrations run on first access — see middleware/principal.ts.
 */

import postgres from 'postgres';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import {
  PostgresControlPlaneRegistry,
  PostgresTenantDbProvider,
  runMigrations,
} from '@atlas/adapters-node';
import type { AppConfig } from './config.ts';

export interface AppState {
  readonly config: AppConfig;
  readonly controlPlaneSql: postgres.Sql;
  readonly tenantDb: PostgresTenantDbProvider;
  readonly controlPlaneRegistry: PostgresControlPlaneRegistry;
  /**
   * Lazily resolved JWKS. Null when test-auth is enabled and no JWKS URL was
   * configured. The principal middleware checks before invoking.
   */
  readonly jwks: JWTVerifyGetKey | null;
  /**
   * Set of tenant ids whose tenant-DB migrations have already been applied
   * during this process lifetime. The principal middleware adds entries on
   * first access. Re-runs at process restart are no-ops thanks to the
   * `_migrations` bookkeeping table the runner installs.
   */
  readonly migratedTenants: Set<string>;
}

export async function bootstrap(config: AppConfig): Promise<AppState> {
  const controlPlaneSql = postgres(config.controlPlaneDbUrl, { max: 5 });

  // Probe the connection up front — fail loud at boot rather than mid-request.
  await controlPlaneSql`SELECT 1`;

  // Apply control-plane schema migrations. Idempotent; re-runs are no-ops.
  await runMigrations(controlPlaneSql, 'control-plane');

  const tenantDb = new PostgresTenantDbProvider(controlPlaneSql);
  const controlPlaneRegistry = new PostgresControlPlaneRegistry(controlPlaneSql);

  let jwks: JWTVerifyGetKey | null = null;
  if (config.oidc.jwksUrl) {
    try {
      jwks = createRemoteJWKSet(new URL(config.oidc.jwksUrl));
    } catch (e) {
      // Bad URL parse should be loud; downstream "fetch failed" is lazy.
      throw new Error(
        `failed to construct JWKS resolver for ${config.oidc.jwksUrl}: ${(e as Error).message}`,
      );
    }
  }

  return {
    config,
    controlPlaneSql,
    tenantDb,
    controlPlaneRegistry,
    jwks,
    migratedTenants: new Set<string>(),
  };
}

/**
 * Apply tenant-DB migrations on first access for a given tenant. Cached
 * via `state.migratedTenants` so subsequent requests skip the runner.
 */
export async function ensureTenantMigrated(
  state: AppState,
  tenantId: string,
): Promise<postgres.Sql> {
  const sql = await state.tenantDb.getPool(tenantId);
  if (!state.migratedTenants.has(tenantId)) {
    await runMigrations(sql, 'tenant');
    state.migratedTenants.add(tenantId);
  }
  return sql;
}

export async function shutdown(state: AppState): Promise<void> {
  await Promise.allSettled([
    state.tenantDb.close(),
    state.controlPlaneSql.end({ timeout: 5 }),
  ]);
}
