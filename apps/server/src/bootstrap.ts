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
  EnvSecretStore,
  NodeCompression,
  NodeCrypto,
  PostgresControlPlaneRegistry,
  PostgresCustomDomainStore,
  PostgresDslArtifactStore,
  PostgresEmailLogStore,
  PostgresEntityStore,
  PostgresEntityTypeRegistry,
  PostgresRelationStore,
  PostgresRepositoryRevisionStore,
  PostgresRepositoryStore,
  PostgresSignupRequestStore,
  PostgresTenantDbProvider,
  PostgresTenantStore,
  SmtpMailer,
  StdoutEventMailer,
  runMigrations,
} from '@atlas/adapter-node';
import { makeDslKindRegistry, type DslKind, type DslKindRegistry } from '@atlas/dsl';
import {
  ExpressionEvaluator,
  makeExpressionRegistry,
  parse as parseExpression,
} from '@atlas/dsl-expression';
import type { HostOpSet } from '@atlas/dsl-substrate';
import type {
  Compression,
  Crypto,
  CustomDomainStore,
  EmailLogStore,
  EntityStore,
  EntityTypeRegistry,
  Mailer,
  RelationStore,
  RepositoryRevisionStore,
  RepositoryStore,
  SecretStore,
  SignupRequestStore,
  TenantStore,
} from '@atlas/ports';
import { setIdentityCrypto } from '@atlas/identity';
import {
  PLATFORM_ADMIN_PRINCIPAL_ID,
  PLATFORM_TENANT_ID,
  reconcileEntityIndexes,
  UpcasterRegistry,
} from '@atlas/platform-core';
import { seedPlatformAdmin } from './bootstrap-platform-admin.ts';
import { TenantHostCache } from './middleware/tenant-resolution.ts';
import { StubPolicyEngine } from '@atlas/adapter-policy-stub';
import { NodeWasmHost, FilesystemPluginLoader } from '@atlas/wasm-host';
import type { WasmHost } from '@atlas/ports';
import {
  CedarPolicyEngine,
  PostgresBundleLoader,
  generateCedarSchema,
} from '@atlas/adapter-policy-cedar';
import { moduleManifests } from '@atlas/schemas';
import type { PolicyEngine } from '@atlas/ports';
import type { AtlasExecutionContext } from '@atlas/platform-core';
import { PrincipalCache } from '@atlas/platform-core';
import type { LevelController, LogPipeline, MemoryRingBufferSink } from '@atlas/logging';
import type { AppConfig } from './config.ts';
import { ServerEventBroadcast } from './events/broadcast.ts';

export interface AppState {
  readonly config: AppConfig;
  /**
   * Process-wide logging pipeline. Sinks: ConsoleJsonSink (stdout) +
   * MemoryRingBufferSink (in-memory ring for atlasctl inspection — see
   * specs/crosscut/logging.md and PR 3 for atlasctl logging commands).
   * Per-request loggers come from `c.var.ctx.logger`, never from a
   * direct factory call. Built in main.ts before bootstrap; passed in.
   */
  readonly logPipeline: LogPipeline;
  /**
   * Runtime log-level controller. Resolution precedence:
   * correlation > tenant > module > global > default. Mutated by atlasctl
   * via the admin/logging routes.
   */
  readonly levelController: LevelController;
  /**
   * Bounded ring buffer of recent LogEvents, queryable by correlationId.
   * Used by the admin/logging/correlation/:id/recent route for
   * incident-time inspection. Lifetime: process. Lost on restart;
   * persistent inspection is a future capability.
   */
  readonly inspectionSink: MemoryRingBufferSink;
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
   * Per-request principal enrichment cache. `enrichPrincipal` in
   * `middleware/state.ts` reads through this before falling back to
   * the three tenant-pool reads (User by IDP subject, optional User by
   * id, Membership). Tag-driven invalidation runs in
   * `principalCacheDispatcher`; TTL is a safety net only.
   */
  readonly principalCache: PrincipalCache;
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
   * Process-wide registry of DSL kinds (expression, template, query, …).
   * Built once at boot; injected per-request alongside the per-tenant
   * `DslArtifactStore` into the DSL handler factory. Currently only the
   * expression DSL is wired; template + query land in subsequent slices.
   * See `specs/decisions/0007-dsl-substrate-and-authoring-contract.md`.
   */
  readonly dslKindRegistry: DslKindRegistry;
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
  /**
   * First-vertical-slice surfaces. `signupRequests` and `tenants` are
   * control-plane-scoped writers used by the public signup → admin
   * approval flow (`routes/signup.ts`, `routes/admin-signups.ts`).
   * `mailer` dispatches the magic-link email; `emailLog` is the read
   * side that the in-app mailbox panel will tail in PR4/PR5.
   */
  readonly signupRequests: SignupRequestStore;
  readonly tenants: TenantStore;
  readonly mailer: Mailer;
  readonly emailLog: EmailLogStore;
  /**
   * Process-wide secret lookup. Snapshotted from `process.env` at boot.
   * Modules read named secrets through this port instead of reaching for
   * `process.env` directly (closes ADR 0008 leak #4 / SecretStore slice).
   * Production swaps `EnvSecretStore` for a sealed-secrets / KMS-backed
   * impl with the same surface.
   */
  readonly secrets: SecretStore;
  /**
   * Symmetric byte-level compression (raw DEFLATE today). Backs identity's
   * SAML AuthnRequest builder; modules MUST NOT import `node:zlib`
   * directly. Closes ADR 0008 leak #1 (`node:zlib` in identity SAML).
   */
  readonly compression: Compression;
  /**
   * Sync crypto primitives (random bytes, sha256, hmac-sha1, AES-GCM,
   * scrypt, timing-safe compare). Wired into identity at boot via
   * `setIdentityCrypto`; consumed directly by `repository.handleUpload`.
   * Closes ADR 0008 leak #1 (`node:crypto` / `node:buffer` in modules).
   */
  readonly crypto: Crypto;
}

export interface BootstrapDeps {
  /** Built before bootstrap by main.ts so the very first boot log has structure. */
  readonly logPipeline: LogPipeline;
  readonly levelController: LevelController;
  /** Typed reference to the in-pipeline ring buffer; used by admin-logging inspection. */
  readonly inspectionSink: MemoryRingBufferSink;
  /** System ctx for boot-time logs. */
  readonly bootCtx: AtlasExecutionContext;
}

export async function bootstrap(config: AppConfig, deps: BootstrapDeps): Promise<AppState> {
  const controlPlaneSql = postgres(config.controlPlaneDbUrl, { max: 5 });

  // Probe the connection up front — fail loud at boot rather than mid-request.
  await controlPlaneSql`SELECT 1`;

  // Apply control-plane schema migrations. Idempotent; re-runs are no-ops.
  await runMigrations(controlPlaneSql, 'control-plane');

  // Seed the platform-tenant row. Per ADR 0008 §1 + Stage 2 the platform
  // is a real row in `control_plane.tenants` — code paths that used to
  // hard-code `'_platform'` now read PLATFORM_TENANT_ID and expect a
  // real row to exist (foreign keys, audit emits, principal middleware).
  //
  // Idempotent by construction: ON CONFLICT DO NOTHING on the primary
  // key. The RETURNING clause is empty on subsequent boots, which is how
  // we suppress the info log on re-boot.
  const platformTenantInsert = await controlPlaneSql<{ tenant_id: string }[]>`
    INSERT INTO control_plane.tenants (tenant_id, name, status, region)
    VALUES (${PLATFORM_TENANT_ID}, 'Atlas Platform', 'active', NULL)
    ON CONFLICT (tenant_id) DO NOTHING
    RETURNING tenant_id
  `;
  if (platformTenantInsert.length > 0) {
    deps.bootCtx.logger.info('platform-tenant row seeded', {
      event: 'Server.Boot.PlatformTenantSeeded',
      properties: { tenantId: PLATFORM_TENANT_ID },
    });
  }

  // ADR 0005 §"Decision" + §"Migration" #4: every tenant — including
  // `_platform` — runs out of its own Postgres database. The server
  // does NOT auto-provision at boot; `pnpm dev:up` is the canonical
  // bootstrap path so the dev/prod posture is symmetric (production
  // operator provisioning uses the same `PostgresTenantDbProvider.
  // provisionTenantDatabase` entrypoint, just not from this file).
  //
  // Refuse to boot if `_platform.db_*` are still NULL — a partially
  // bootstrapped state where the row exists but the per-tenant DB
  // doesn't would otherwise surface deep inside a handler as a confusing
  // pool-resolution failure. Fail loud, point the operator at dev:up.
  const platformDbRow = await controlPlaneSql<
    {
      db_host: string | null;
      db_port: number | null;
      db_name: string | null;
      db_user: string | null;
      db_password: string | null;
    }[]
  >`
    SELECT db_host, db_port, db_name, db_user, db_password
    FROM control_plane.tenants
    WHERE tenant_id = ${PLATFORM_TENANT_ID}
  `;
  const platformDb = platformDbRow[0];
  if (
    !platformDb ||
    platformDb.db_host == null ||
    platformDb.db_port == null ||
    platformDb.db_name == null ||
    platformDb.db_user == null ||
    platformDb.db_password == null
  ) {
    const missing = platformDb
      ? Object.entries({
          db_host: platformDb.db_host,
          db_port: platformDb.db_port,
          db_name: platformDb.db_name,
          db_user: platformDb.db_user,
          db_password: platformDb.db_password,
        })
          .filter(function ([, v]) {
            return v == null;
          })
          .map(function ([k]) {
            return k;
          })
      : ['<row missing>'];
    deps.bootCtx.logger.fatal('platform tenant database not provisioned — refusing to start', {
      event: 'Server.Boot.PlatformDatabaseMissing',
      properties: {
        tenantId: PLATFORM_TENANT_ID,
        missing,
      },
    });
    throw new Error(
      `Platform tenant '${PLATFORM_TENANT_ID}' is missing per-tenant database ` +
        `connection coordinates (${missing.join(', ')}). ` +
        `Run \`pnpm dev:up\` to provision the per-tenant DB before starting the server. ` +
        `See ADR 0005 (db-per-tenant) and ADR 0015 §5 (dev-up seed contract).`,
    );
  }

  // ADR 0005 commits to db-per-tenant — fail-closed, no shared-DB
  // fallback. The platform-tenant `db_*` NULL guard above ensures the
  // server only boots when `_platform` is fully provisioned; every
  // other tenant must also have populated `db_*` (via the signup
  // provisioner in production, via `pnpm dev:up` in dev) before its
  // first request, or `getPool(tenantId)` throws
  // `TENANT_DATABASE_NOT_PROVISIONED`.
  const tenantDb = new PostgresTenantDbProvider(controlPlaneSql);
  const controlPlaneRegistry = new PostgresControlPlaneRegistry(
    controlPlaneSql,
    deps.bootCtx.logger,
  );
  const customDomains = new PostgresCustomDomainStore(controlPlaneSql);
  const customDomainCache = new TenantHostCache();
  const principalCache = new PrincipalCache();
  const entityTypeRegistry = new PostgresEntityTypeRegistry(controlPlaneSql);
  const upcasterRegistry = new UpcasterRegistry();

  // DSL kind registry — process-wide. Each registered DSL contributes a
  // `DslKind` descriptor with its parser + evaluator + host-op set.
  // Slice #5: only the expression DSL is wired; template + query land
  // when their packages ship. Adding a kind is one line here plus the
  // sibling concrete-DSL package.
  const expressionEvaluator = new ExpressionEvaluator();
  const expressionRegistry = makeExpressionRegistry();
  const expressionKind: DslKind<unknown, unknown, unknown, HostOpSet> = {
    kind: 'expression',
    parse: (source: string) =>
      parseExpression(source) as ReturnType<DslKind<unknown, unknown, unknown, HostOpSet>['parse']>,
    evaluator: expressionEvaluator,
    registry: expressionRegistry,
  };
  const dslKindRegistry = makeDslKindRegistry([expressionKind]);

  let jwks: JWTVerifyGetKey | null = null;
  if (config.oidc.jwksUrl) {
    try {
      jwks = createRemoteJWKSet(new URL(config.oidc.jwksUrl));
    } catch (e) {
      // Bad URL parse should be loud; downstream "fetch failed" is lazy.
      const cause = e instanceof Error ? e.message : String(e);
      throw new Error(`failed to construct JWKS resolver for ${config.oidc.jwksUrl}: ${cause}`);
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
      const schema = generateCedarSchema(moduleManifests());
      policyEngine = new CedarPolicyEngine(new PostgresBundleLoader(controlPlaneSql), { schema });
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

  // First-vertical-slice surfaces (signup → approve → magic link).
  const signupRequests = new PostgresSignupRequestStore(controlPlaneSql);
  const tenants = new PostgresTenantStore(controlPlaneSql);
  const emailLog = new PostgresEmailLogStore(controlPlaneSql);
  let mailer: Mailer;
  switch (config.mailerMode) {
    case 'noop':
      mailer = {
        send: async function () {
          return {
            messageId: 'noop',
            sentAt: new Date().toISOString(),
          };
        },
      };
      break;
    case 'smtp': {
      // `mailerMode === 'smtp'` is gated by config-loader to require
      // host/port/from; the null check below mirrors that guarantee.
      const smtp = config.smtp;
      if (!smtp) {
        throw new Error('mailerMode=smtp but no smtp config — config loader contract broken');
      }
      mailer = new SmtpMailer(controlPlaneSql, smtp, deps.bootCtx.logger);
      break;
    }
    case 'stdout':
    default:
      mailer = new StdoutEventMailer(controlPlaneSql);
      break;
  }
  deps.bootCtx.logger.info('mailer driver selected', {
    event: 'Server.Boot.MailerSelected',
    properties: { driver: config.mailerMode },
  });

  // Snapshot process.env at boot. Modules read named secrets through
  // this port instead of touching process.env directly.
  const secrets = new EnvSecretStore();

  // Process-wide compression port (Node zlib backend).
  const compression = new NodeCompression();

  // Process-wide crypto port (Node crypto backend). Wire identity's
  // resolver immediately so handlers loaded from `@atlas/identity`
  // can find their Crypto on first call.
  const crypto = new NodeCrypto();
  setIdentityCrypto(crypto);

  const state: AppState = {
    config,
    logPipeline: deps.logPipeline,
    levelController: deps.levelController,
    inspectionSink: deps.inspectionSink,
    controlPlaneSql,
    tenantDb,
    controlPlaneRegistry,
    customDomains,
    customDomainCache,
    principalCache,
    entityTypeRegistry,
    upcasterRegistry,
    dslKindRegistry,
    jwks,
    migratedTenants: new Set<string>(),
    policyEngine,
    wasmHost,
    serverEvents,
    signupRequests,
    tenants,
    mailer,
    emailLog,
    secrets,
    compression,
    crypto,
  };

  // Dev-mode boot banner (ADR 0015 §3 layer 3). Emitted at `warn` so it
  // surfaces in default log scrapes; the visible message names exactly
  // what is bypassed so an operator looking at a misconfigured prod box
  // catches it on first glance.
  if (config.devMode.enabled) {
    deps.bootCtx.logger.warn(
      'DEV MODE ENABLED — auth bypassed for unauthenticated requests — DO NOT EXPOSE',
      {
        event: 'Server.Boot.DevModeEnabled',
        properties: {
          principalId: config.devMode.principalId,
          tenantId: config.devMode.tenantId,
          roles: [...config.devMode.roles],
          policyEngine: config.policyEngine,
          tenantApex: config.tenantApex,
        },
      },
    );
  }

  // Seed the canonical platform-admin User + Membership in `_platform`.
  // Idempotent: returns `{ created: false }` when the User entity already
  // exists. This gives test/itest/BDD code a real principal row to point
  // `X-Debug-Principal: user:platform-admin:_platform:admin` at, rather
  // than relying on synthesized role hydration alone.
  //
  // Runs AFTER `state` is built so `ensureTenantMigrated` (which uses
  // `state.migratedTenants` and `state.entityTypeRegistry`) is callable.
  // Mirrors the `Server.Boot.PlatformTenantSeeded` log pattern above —
  // single info line on the run that inserts, zero on subsequent boots.
  const platformSql = await ensureTenantMigrated(state, PLATFORM_TENANT_ID);
  const platformEntities = entityStoreFor(platformSql, state);
  const seedResult = await seedPlatformAdmin(platformEntities);
  if (seedResult.created) {
    deps.bootCtx.logger.info('platform-admin seeded', {
      event: 'Tenancy.PlatformAdmin.Seeded',
      properties: {
        userId: PLATFORM_ADMIN_PRINCIPAL_ID,
        tenantId: PLATFORM_TENANT_ID,
      },
    });
  }

  return state;
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
 * Per-tenant `RepositoryStore` — Code platform / `repository` domain.
 *
 * Constructed per-request the same way `entityStoreFor` /
 * `relationStoreFor` are (cheap closures over the per-tenant `Sql`).
 * Bytes flow through `repositoryRevisionStoreFor` — split per-port so
 * the bytes side can migrate to object storage without disturbing the
 * metadata surface.
 */
export function repositoryStoreFor(sql: postgres.Sql): RepositoryStore {
  return new PostgresRepositoryStore(sql);
}

export function repositoryRevisionStoreFor(sql: postgres.Sql): RepositoryRevisionStore {
  return new PostgresRepositoryRevisionStore(sql);
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
export async function reconcileTenantIndexes(state: AppState, sql: postgres.Sql): Promise<void> {
  const declared = await state.entityTypeRegistry.listAllPlatformIndexes();
  const liveRows = await sql<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'entities'
  `;
  const live = new Set(
    liveRows.map(function (r) {
      return r.indexname;
    }),
  );
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
 * Mark a tenant as ready and return its `Sql` pool.
 *
 * ADR 0005 db-per-tenant: provisioning (via
 * `PostgresTenantDbProvider.provisionTenantDatabase`) is the only path
 * that creates a tenant's database, runs tenant migrations as the
 * provisioner role, and populates `control_plane.tenants.db_*`. The
 * pool returned by `getPool(tenantId)` connects as the runtime role,
 * which does NOT have `CREATE` on `public` — so re-running the
 * migration runner from here would fail with `permission denied for
 * schema public`. We never run migrations from this hook anymore.
 *
 * The phase-3 removal of the shared-DB fallback means a tenant
 * without populated `db_*` throws `TENANT_DATABASE_NOT_PROVISIONED`
 * at `getPool` time. There is no in-band recovery; provisioning is
 * always out-of-band (signup-approval in prod, `pnpm dev:up` in dev).
 */
export async function ensureTenantMigrated(
  state: AppState,
  tenantId: string,
): Promise<postgres.Sql> {
  const sql = await state.tenantDb.getPool(tenantId);
  if (!state.migratedTenants.has(tenantId)) {
    // Provisioning already applied migrations under the provisioner role.
    // Mark the tenant as "migrated" for this process so we don't re-check.
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
  // Release SMTP transport pool (no-op for stdout/noop drivers since
  // `close` is optional on the port).
  await state.mailer.close?.();
  await state.controlPlaneSql.end({ timeout: 5 });
}
