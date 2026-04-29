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
import { StubPolicyEngine } from '@atlas/adapters-policy-stub';
import {
  CedarPolicyEngine,
  PostgresBundleLoader,
} from '@atlas/adapters-policy-cedar';
import type { PolicyEngine } from '@atlas/ports';
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
  /**
   * The authorization seam. Selected at boot via `config.policyEngine`.
   * v1 (Chunk 6a) only the `stub` engine is wired; `cedar` lands in 6b.
   */
  readonly policyEngine: PolicyEngine;
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

  // Policy engine selection. `cedar` loads per-tenant Cedar bundles from
  // `control_plane.policies` via `PostgresBundleLoader`; tenants without
  // an active bundle fall back to permissive (allow-all-with-tenant-scope)
  // semantics — see `CedarPolicyEngine` file header for rationale.
  let policyEngine: PolicyEngine;
  switch (config.policyEngine) {
    case 'stub':
      policyEngine = new StubPolicyEngine();
      break;
    case 'cedar':
      policyEngine = new CedarPolicyEngine(
        new PostgresBundleLoader(controlPlaneSql),
      );
      break;
  }

  return {
    config,
    controlPlaneSql,
    tenantDb,
    controlPlaneRegistry,
    jwks,
    migratedTenants: new Set<string>(),
    policyEngine,
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

/**
 * Tear down per-tenant pools first (they reference `controlPlaneSql` for
 * tenant-DB lookups via `lookupConnectionInfo`), then end the control-plane
 * pool. Closing them in parallel can race a tenant pool that is still
 * resolving its connection info — see audit F1.
 */
export async function shutdown(state: AppState): Promise<void> {
  await state.tenantDb.close();
  await state.controlPlaneSql.end({ timeout: 5 });
}
