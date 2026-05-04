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
  PostgresCustomDomainStore,
  PostgresEntityStore,
  PostgresEntityTypeRegistry,
  PostgresRelationStore,
  PostgresTenantDbProvider,
  runMigrations,
} from '@atlas/adapter-node';
import type {
  CustomDomainStore,
  EntityStore,
  EntityTypeRegistry,
  RelationStore,
} from '@atlas/ports';
import { reconcileEntityIndexes, UpcasterRegistry } from '@atlas/platform-core';
import { TenantHostCache } from './middleware/tenant-resolution.ts';
import { StubPolicyEngine } from '@atlas/adapter-policy-stub';
import {
  NodeWasmHost,
  FilesystemPluginLoader,
} from '@atlas/wasm-host';
import type { WasmHost } from '@atlas/ports';
import {
  CedarPolicyEngine,
  PostgresBundleLoader,
  generateCedarSchema,
} from '@atlas/adapter-policy-cedar';
import type { ModuleManifest } from '@atlas/adapter-policy-cedar';
import { moduleManifests } from '@atlas/schemas';
import type { PolicyEngine } from '@atlas/ports';
import type { AppConfig } from './config.ts';
import { ServerEventBroadcast } from './events/broadcast.ts';

export interface AppState {
  readonly config: AppConfig;
  readonly controlPlaneSql: postgres.Sql;
  readonly tenantDb: PostgresTenantDbProvider;
  readonly controlPlaneRegistry: PostgresControlPlaneRegistry;
  /**
   * Custom-domain (host header → tenant id) store. Stub-mode today —
   * see `specs/domains/tenancy/capabilities/custom-domains/README.md`.
   * The host resolver in `middleware/principal.ts` reads through
   * `customDomainCache` to avoid one DB round-trip per request.
   */
  readonly customDomains: CustomDomainStore;
  readonly customDomainCache: TenantHostCache;
  /**
   * L3 substrate: read-side metadata + the generic entity store. The
   * registry resolves "tenant override > platform default" when a
   * Phase F caller asks for a tenant-specific schema; for now (Phase A)
   * everything's a platform default.
   *
   * The upcaster registry is shared per-process; modules register their
   * version-step transforms at boot. See
   * `packages/platform-core/src/upcaster.ts`.
   */
  readonly entityTypeRegistry: EntityTypeRegistry;
  readonly upcasterRegistry: UpcasterRegistry;
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
  /**
   * Process-wide WASM plugin host. Stateless across invocations
   * (each `invoke` builds a fresh `WebAssembly.Instance`), so a
   * single instance is shared across all requests. Loader resolves
   * `pluginRef` against `WASM_PLUGIN_DIR`. Wired into the
   * content-pages dispatcher; the render-tree projection consults
   * `pageDocument.pluginRef` and falls back to the default tree
   * when no plugin is named.
   */
  readonly wasmHost: WasmHost;
  /**
   * Process-wide broadcast channel for `ServerEvent`s. Mirrors the Rust
   * ingress's `tokio::sync::broadcast::Sender<ServerEvent>` (see
   * `crates/ingress/src/main.rs` AppState). Published to from the
   * per-request dispatcher chain (`serverEventDispatcher` in
   * `middleware/state.ts`); consumed by the SSE handler at
   * `routes/events.ts` and the WS handler when it lands.
   *
   * In-memory + per-process — for multi-replica deployments this needs
   * replacing with a fan-out via Redis pub/sub or similar. The Rust
   * binary has the same limitation today.
   */
  readonly serverEvents: ServerEventBroadcast;
}

export async function bootstrap(config: AppConfig): Promise<AppState> {
  const controlPlaneSql = postgres(config.controlPlaneDbUrl, { max: 5 });

  // Probe the connection up front — fail loud at boot rather than mid-request.
  await controlPlaneSql`SELECT 1`;

  // Apply control-plane schema migrations. Idempotent; re-runs are no-ops.
  await runMigrations(controlPlaneSql, 'control-plane');

  const tenantDb = new PostgresTenantDbProvider(controlPlaneSql);
  const controlPlaneRegistry = new PostgresControlPlaneRegistry(controlPlaneSql);
  const customDomains = new PostgresCustomDomainStore(controlPlaneSql);
  const customDomainCache = new TenantHostCache();
  const entityTypeRegistry = new PostgresEntityTypeRegistry(controlPlaneSql);
  const upcasterRegistry = new UpcasterRegistry();

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
    case 'cedar': {
      // Per-deployment schema (Chunk 6c) — generated once at boot from the
      // bundled module manifests. Every tenant's policies validate against
      // the same schema; tenants only customise *policies*, not types.
      const schema = generateCedarSchema(moduleManifests() as ModuleManifest[]);
      policyEngine = new CedarPolicyEngine(
        new PostgresBundleLoader(controlPlaneSql),
        { schema },
      );
      break;
    }
    default:
      // Adding a new `PolicyEngineKind` without a case here is a compile
      // error rather than silent fall-through.
      assertNever(config.policyEngine);
  }

  // Build the WASM host once at boot — fresh `Store`/`Instance` per
  // `invoke` is the security model, but the loader caches `.wasm`
  // bytes per process so we don't re-read disk on every request.
  // `WASM_PLUGIN_DIR` env var honored, default `./plugins`.
  const wasmHost: WasmHost = new NodeWasmHost({
    loader: new FilesystemPluginLoader(),
  });

  // Capacity 256 matches the Rust ingress's
  // `broadcast::channel::<ServerEvent>(256)` so per-subscriber lag
  // semantics are equivalent across runtimes.
  const serverEvents = new ServerEventBroadcast(256);

  return {
    config,
    controlPlaneSql,
    tenantDb,
    controlPlaneRegistry,
    customDomains,
    customDomainCache,
    entityTypeRegistry,
    upcasterRegistry,
    jwks,
    migratedTenants: new Set<string>(),
    policyEngine,
    wasmHost,
    serverEvents,
  };
}

/**
 * Per-tenant on-demand helpers for the L3 substrate.
 *
 * Constructed when the request-scoped tenant pool is available
 * (`ensureTenantMigrated`). The entity store and relation store are
 * cheap to construct (just hold the `Sql`), so we do it per-request
 * rather than caching — keeps the lifetime aligned with the pool.
 */
export function entityStoreFor(sql: postgres.Sql, state: AppState): EntityStore {
  // Pre-populate latest-version map from the registry so writes default
  // correctly when callers don't pin a version. The registry is fetched
  // lazily; a stale value here just means writes go in at an older
  // version, which the upcaster pipeline corrects on read.
  // For now we keep the map empty; modules that care set their own
  // explicit `schemaVersion` on each `put`. Phase A.5 wires the
  // population.
  void state;
  return new PostgresEntityStore(sql);
}

export function relationStoreFor(sql: postgres.Sql): RelationStore {
  return new PostgresRelationStore(sql);
}

/**
 * Reconcile expression indexes on a tenant's `entities` table against
 * the platform-default `index_registry`. Run after tenant migrations
 * apply. Idempotent — uses `CREATE INDEX IF NOT EXISTS`.
 *
 * Index materialization at deploy time was the recommendation in the
 * L3 plan ("predictable but slower rollout") rather than runtime
 * reconciliation. Per-tenant first-touch is effectively the deploy
 * time for a tenant; subsequent boots see the indexes already there
 * and the reconcile is a no-op.
 */
export async function reconcileTenantIndexes(
  state: AppState,
  sql: postgres.Sql,
): Promise<void> {
  const declared = await state.entityTypeRegistry.listAllPlatformIndexes();
  const liveRows = await sql<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'entities'
  `;
  const live = new Set(liveRows.map((r) => r.indexname));
  const { create, drop } = reconcileEntityIndexes(declared, live);
  for (const stmt of drop) {
    await sql.unsafe(stmt);
  }
  for (const stmt of create) {
    await sql.unsafe(stmt);
  }
}

function assertNever(x: never): never {
  throw new Error(`unreachable: unexpected value ${JSON.stringify(x)}`);
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
    // After base migrations, reconcile the platform-default expression
    // indexes on `entities`. No-op when no platform indexes have been
    // registered yet (Phase A initial state).
    await reconcileTenantIndexes(state, sql);
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
