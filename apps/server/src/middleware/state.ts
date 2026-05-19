/**
 * Per-request `IngressState` + `CatalogQueryDeps` construction.
 *
 * We rebuild adapters per request because each tenant has its own
 * `postgres.Sql` (resolved through the LRU pool cache in TenantDbProvider).
 * Adapter instances are cheap closures over the Sql connection; this is not
 * a hot path concern. If profiling later flags it, cache them per tenant.
 */

import {
  PostgresEventStore,
  PostgresCache,
  PostgresProjectionStore,
  PostgresSearchEngine,
  PostgresCatalogStateStore,
  PostgresPolicyStore,
} from '@atlas/adapter-node';
import { policyEvaluatedEvent, shouldEmitPolicyEvaluated } from '@atlas/ports';
import {
  catalogHandlerRegistry,
  catalogDispatcher,
  type CatalogQueryDeps,
} from '@atlas/catalog';
import {
  authzHandlerRegistry,
  composeRegistries,
} from '@atlas/authz';
import {
  contentPagesHandlerRegistry,
  contentPagesDispatcher,
  type ContentPagesQueryDeps,
} from '@atlas/content-pages';
import {
  identityHandlerRegistry,
  identityDispatcher,
  findUserByIdpSubject,
  getMembershipEntity,
  type IdentityQueryDeps,
} from '@atlas/identity';
import {
  repositoryDispatcher,
  repositoryHandlerRegistry,
} from '@atlas/repository';
import { policyCacheDispatcher } from '@atlas/adapter-policy-cedar';
import type { CedarBundleCache } from '@atlas/adapter-policy-cedar';
import type {
  IngressState,
  EventDispatcher,
} from '@atlas/ingress';
import { cacheTagDispatcher, composeDispatchers } from '@atlas/ports';
import type { PolicyEngine } from '@atlas/ports';
import type { Principal, PrincipalCache } from '@atlas/platform-core';
import { createSystemContext } from '@atlas/logging';
import {
  ensureTenantMigrated,
  entityStoreFor,
  relationStoreFor,
  repositoryRevisionStoreFor,
  repositoryStoreFor,
  type AppState,
} from '../bootstrap.ts';
import { serverEventDispatcher } from '../events/dispatcher.ts';
import { principalCacheDispatcher } from '../events/principal-cache-dispatcher.ts';
import { errorMessage } from './errors.ts';

function newAuditId(): string {
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Process-level latch for the `worker.dispatch.skipped` log line. We log
 * once on the first async-mode dispatch call so operators can see the
 * cut-over flag is active, but don't spam every request thereafter.
 */
let asyncDispatchSkipLogged = false;

/**
 * Wrap a dispatcher closure so each invocation emits a `Dispatcher.Ran`
 * debug line on the per-request ctx. Captures durationMs and surfaces
 * eventType (already on the envelope) so the trace shows which dispatcher
 * touched which event. Errors propagate unchanged — composeDispatchers'
 * error semantics are preserved.
 */
function instrumentDispatcher(
  name: string,
  state: AppState,
  tenantId: string,
  correlationId: string,
  d: EventDispatcher,
): EventDispatcher {
  return async function (envelope) {
    const ctx = createSystemContext({
      pipeline: state.logPipeline,
      environment: state.config.environment,
      tenantId,
      moduleId: '@atlas/server',
      correlationId,
    });
    const started = performance.now();
    try {
      await d(envelope);
      ctx.logger.debug('dispatcher ran', {
        event: 'Dispatcher.Ran',
        durationMs: performance.now() - started,
        properties: {
          dispatcher: name,
          eventType: envelope.eventType,
          eventId: envelope.eventId,
        },
      });
    } catch (e) {
      ctx.logger.debug('dispatcher failed', {
        event: 'Dispatcher.Ran',
        durationMs: performance.now() - started,
        properties: {
          dispatcher: name,
          eventType: envelope.eventType,
          eventId: envelope.eventId,
          error: errorMessage(e),
        },
      });
      throw e;
    }
  };
}

/**
 * Build the no-op dispatcher used when `WORKER_MODE=async`. Matches the
 * `EventDispatcher` signature so the call sites in `submitIntent` and
 * the audit hook are mode-agnostic. Emits a single structured log line
 * the first time it's invoked process-wide.
 */
function buildAsyncNoopDispatch(
  state: AppState,
  tenantId: string,
  correlationId: string,
): EventDispatcher {
  return async function (envelope) {
    if (!asyncDispatchSkipLogged) {
      asyncDispatchSkipLogged = true;
      const ctx = createSystemContext({
        pipeline: state.logPipeline,
        environment: state.config.environment,
        tenantId,
        moduleId: '@atlas/server',
        correlationId,
      });
      ctx.logger.info('worker dispatch skipped (async mode)', {
        event: 'Worker.Dispatch.Skipped',
        properties: {
          mode: 'async',
          reason:
            'WORKER_MODE=async — inline dispatch is a no-op; projection-worker drains the event store',
          firstEventType: envelope.eventType,
          firstEventId: envelope.eventId,
        },
      });
    }
  };
}

/**
 * Structural type guard — is this engine a Cedar bundle cache (i.e.
 * exposes `invalidate` + `invalidateAll`)? The stub engine doesn't,
 * so the wiring layer skips wiring `wirePolicyCacheInvalidation` for
 * stub-mode deployments.
 */
function isBundleCache(engine: PolicyEngine): engine is PolicyEngine & CedarBundleCache {
  // `PolicyEngine` doesn't declare the bundle-cache methods — read them
  // through `Reflect.get` so the probe stays inside `unknown` and we
  // don't smuggle the cedar shape in via a structural cast.
  const invalidate: unknown = Reflect.get(engine, 'invalidate');
  const invalidateAll: unknown = Reflect.get(engine, 'invalidateAll');
  return typeof invalidate === 'function' && typeof invalidateAll === 'function';
}

export interface RequestBundle {
  ingress: IngressState;
  catalogDeps: CatalogQueryDeps;
  contentPagesDeps: ContentPagesQueryDeps;
  identityDeps: IdentityQueryDeps;
  /**
   * The principal as enriched against the request tenant's identity
   * data: `userId` and `roles` populated from `User`/`Membership` lookups,
   * `attributes` carrying User attrs for ABAC. The basic `Principal`
   * (just `principalId` + `tenantId`) is what the principal middleware
   * sets; this is what downstream callers should prefer when they need
   * RBAC/ABAC.
   */
  principal: Principal;
}

/**
 * Canonical, ordered list of the dispatcher names that compose the
 * inline request dispatcher chain (Phase 2 / I12 worker-mirror invariant).
 *
 * Exposed so tests can assert structural parity with the projection
 * worker's chain in `apps/projection-worker/src/tenant-loop.ts` without
 * having to construct adapter instances. Adding or reordering a
 * dispatcher in either composition MUST update this list.
 *
 * Order is significant: `cache-tag` runs after the per-module dispatchers
 * so emitted tags are picked up; `policy-cache` runs after `cache-tag`
 * so the next evaluate sees the freshly-activated bundle; `server-events`
 * runs last so SSE subscribers only see events whose projections have
 * been rebuilt.
 */
export const REQUEST_DISPATCHER_CHAIN_NAMES: ReadonlyArray<string> = [
  'catalog',
  'content-pages',
  'identity',
  'repository',
  'cache-tag',
  'principal-cache',
  'policy-cache',
  'server-events',
];

/**
 * Test-only override for {@link buildRequestBundle}. Node ESM modules are
 * immutable post-import, so `node:test` has no `vi.mock`-equivalent — route
 * suites that need to inject a hand-built bundle install a stub here. The
 * setter resets cleanly via `beforeEach`. Production code MUST NOT touch it.
 *
 * Marked `@internal`; only `apps/server/test/**` should import the setter.
 */
let _buildRequestBundleOverride:
  | ((state: AppState, principal: Principal, correlationId: string) => Promise<RequestBundle>)
  | null = null;

/** @internal — test-only. */
export function __setBuildRequestBundleForTest(
  fn:
    | ((state: AppState, principal: Principal, correlationId: string) => Promise<RequestBundle>)
    | null,
): void {
  _buildRequestBundleOverride = fn;
}

export function buildRequestBundle(
  state: AppState,
  principal: Principal,
  correlationId: string,
): Promise<RequestBundle> {
  return (_buildRequestBundleOverride ?? _buildRequestBundleImpl)(
    state,
    principal,
    correlationId,
  );
}

async function _buildRequestBundleImpl(
  state: AppState,
  principal: Principal,
  correlationId: string,
): Promise<RequestBundle> {
  const sql = await ensureTenantMigrated(state, principal.tenantId);

  const eventStore = new PostgresEventStore(sql);
  const cache = new PostgresCache(sql);
  const projections = new PostgresProjectionStore(sql);
  const search = new PostgresSearchEngine(sql);
  const catalogState = new PostgresCatalogStateStore(sql);
  // L3 substrate — per-tenant entity + relation stores. Cheap closures
  // over `sql`; one instance per request matches the lifetime of the
  // rest of this bundle. Dispatcher + query deps share these instances.
  const entities = entityStoreFor(sql, state);
  const relations = relationStoreFor(sql);
  // Code platform / `repository` domain. Metadata + bytes split per-port
  // so the bytes side can migrate to object-storage later without
  // disturbing the metadata surface.
  const repositories = repositoryStoreFor(sql);
  const revisions = repositoryRevisionStoreFor(sql);

  // Identity enrichment — resolve User by JWT subject, Membership by
  // (tenantId, userId), then layer roles + attributes onto the
  // Principal so downstream authz reads them. The principal middleware
  // only sets `principalId` + `tenantId`; everything else is hydrated
  // here because the per-tenant entity store doesn't exist until
  // `ensureTenantMigrated` runs.
  //
  // Lookup misses are not failures: bootstrap (no users yet), service
  // principals (no Identity records), and operator principals all hit
  // null. Authz layer denies actions that require RBAC; allowlist
  // routes (health probes, SSE re-auth) check the absence explicitly.
  const enrichedPrincipal = await enrichPrincipal(principal, entities, state.principalCache);

  const policyStore = new PostgresPolicyStore(state.controlPlaneSql);
  const baseHandlers = composeRegistries(
    catalogHandlerRegistry(),
    authzHandlerRegistry(policyStore),
    contentPagesHandlerRegistry(entities),
    identityHandlerRegistry(entities),
    repositoryHandlerRegistry(),
  );
  // The repository handlers expect `repositories` + `repositoryRevisions`
  // on the `IntentHandlerContext`, which the canonical
  // `IntentHandlerContext` shape (in `@atlas/ports`) does not currently
  // carry. The handler registry header (modules/repository/src/handlers/
  // index.ts) calls this out as a wiring-layer responsibility — narrow
  // the gap here by wrapping the resolved handler so the per-request
  // stores are injected onto the context before dispatch.
  const handlers: typeof baseHandlers = {
    get(actionId: string) {
      const inner = baseHandlers.get(actionId);
      if (!inner) return undefined;
      if (!actionId.startsWith('Repository.')) return inner;
      return {
        async handle(ctx, envelope) {
          const extended = { ...ctx, repositories, revisions, crypto: state.crypto };
          return inner.handle(extended, envelope);
        },
      };
    },
  };

  // Cedar-engine bundle-cache invalidation for `Tenant:{tenantId}` tags
  // emitted by activate / archive. Wiring is lazy: only the cedar engine
  // exposes the bundle-cache surface (the stub engine doesn't cache
  // anything). The narrow duck-type guard mirrors the `CedarBundleCache`
  // interface that `policyCacheDispatcher` accepts — no `as` cast needed
  // once the guard returns true.
  const policyBundle: CedarBundleCache | null = isBundleCache(state.policyEngine)
    ? state.policyEngine
    : null;

  // Chunk 8 — dispatcher registry. Each module exports a factory that
  // captures its per-request adapters and returns an `EventDispatcher`.
  // `composeDispatchers` chains them in order; `null` entries are skipped
  // so the conditional cedar-bundle invalidation is one inline ternary
  // rather than a wrapping if-statement.
  //
  // Chain order:
  //   1. catalog projection rebuilds
  //   2. content-pages projection rebuilds (with optional WASM host
  //      threaded through for `pluginRef`-driven render trees, Chunk 10)
  //   3. cross-cutting cache-tag invalidation (was hidden inside
  //      dispatchCatalogEvent pre-Chunk 8 — now its own dispatcher so
  //      adding modules cannot accidentally bypass it)
  //   4. policy-bundle cache invalidation (must run AFTER the rest so
  //      the next evaluate sees the freshly-activated bundle)
  //
  // Adding module #4 is one line in this composer, not a function-body
  // edit further down.
  //
  // Phase-3 cut-over (`specs/worker.md`): when `WORKER_MODE=async` the
  // chain becomes a no-op here — the projection-worker drains events
  // from the event store and runs the same composition out-of-band.
  // We still build `inlineDispatch` first because the call sites
  // (submitIntent, the audit hook below) expect an `EventDispatcher`
  // shape regardless of mode; in async mode we just don't invoke it.
  const wrap = function (name: string, d: EventDispatcher | null): EventDispatcher | null { return d === null ? null : instrumentDispatcher(name, state, principal.tenantId, correlationId, d); };

  // Per-module loggers so flipping a single module to debug surfaces its
  // dispatcher breadcrumbs without spamming the others. Each is built
  // from the same pipeline + tenant/correlation envelope; `moduleId`
  // is what the LevelController consults when resolving per-module
  // overrides set via `atlasctl logging set --module <id> debug`.
  const dispatchCtx = function (moduleId: string) { return createSystemContext({
      pipeline: state.logPipeline,
      environment: state.config.environment,
      tenantId: principal.tenantId,
      moduleId,
      correlationId,
    }); };

  const inlineDispatch: EventDispatcher = composeDispatchers(
    wrap(
      'catalog',
      catalogDispatcher({
        catalogState,
        projections,
        search,
        cache,
        logger: dispatchCtx('@atlas/catalog').logger,
      }),
    ),
    wrap('content-pages', contentPagesDispatcher({
      entities,
      relations,
      cache,
      logger: dispatchCtx('@atlas/content-pages').logger,
      ...(state.wasmHost !== undefined ? { wasmHost: state.wasmHost } : {}),
    })),
    wrap(
      'identity',
      identityDispatcher({
        entities,
        relations,
        cache,
        logger: dispatchCtx('@atlas/identity').logger,
      }),
    ),
    // Code / repository — projection rebuilds for `Repository.Created`
    // and `Repository.Uploaded`. Runs after identity (per-domain
    // ordering) and BEFORE `cacheTagDispatcher` so the cache-tag
    // dispatcher can pick up tags emitted by repository projections.
    wrap(
      'repository',
      repositoryDispatcher({
        repositories,
        revisions,
        cache,
        logger: dispatchCtx('@atlas/repository').logger,
      }),
    ),
    wrap('cache-tag', cacheTagDispatcher(cache)),
    wrap('principal-cache', principalCacheDispatcher(state.principalCache)),
    wrap('policy-cache', policyBundle ? policyCacheDispatcher(policyBundle) : null),
    // Fan freshly-dispatched events out to SSE/WS subscribers. Runs
    // last so subscribers only see events whose projections have been
    // rebuilt and whose cache tags have been invalidated. Mirrors the
    // Rust worker's `event_sender.send(...)` calls (see
    // `crates/ingress/src/worker.rs`).
    wrap('server-events', serverEventDispatcher(state.serverEvents)),
  );

  const dispatch: EventDispatcher =
    state.config.workerMode === 'async'
      ? buildAsyncNoopDispatch(state, principal.tenantId, correlationId)
      : inlineDispatch;

  // Per-request logger — the ingress chokepoint surfaces metrics,
  // attr-lookup, and audit-emit failures through this. Built from the
  // same pipeline + tenant/correlation envelope as the dispatcher
  // instrumentation above so the lines collate with the rest of the
  // request trace. `moduleId` reflects the chokepoint, not a specific
  // domain module.
  const ingressCtx = createSystemContext({
    pipeline: state.logPipeline,
    environment: state.config.environment,
    tenantId: enrichedPrincipal.tenantId,
    moduleId: '@atlas/ingress',
    correlationId,
  });

  const ingress: IngressState = {
    tenantId: enrichedPrincipal.tenantId,
    principalId: enrichedPrincipal.principalId,
    correlationId,
    eventStore,
    cache,
    projections,
    search,
    registry: state.controlPlaneRegistry,
    catalogState,
    logger: ingressCtx.logger,
    // L3 substrate threaded into ingress so submit-intent can populate
    // `resource.attributes` for ABAC. Without this the policy engine
    // sees `{}` for every resource and ABAC rules can never match.
    entities,
    principalRoles: enrichedPrincipal.roles ?? [],
    principalAttributes: enrichedPrincipal.attributes ?? {},
    handlers,
    dispatch,
    policyEngine: state.policyEngine,
    // `StructuredAuthz.PolicyEvaluated` audit emit (Chunk 6c). Persists
    // the envelope to the event store, then dispatches it through the
    // existing pipeline. Persistence is critical: the catalog dispatcher
    // is a no-op for non-catalog event types, so a dispatch-only path
    // would silently drop the audit on the floor. Errors here are
    // swallowed by submitIntent so a flaky audit pipeline never turns a
    // clean deny into a 500.
    //
    // The wiring layer (this hook) owns the emit decision — submitIntent
    // calls the hook unconditionally; the hook itself decides whether
    // to emit by consulting `shouldEmitPolicyEvaluated`. This keeps
    // `AUDIT_EMIT_PERMITS` reads in one place.
    auditPolicyEvaluated: async function (request, decision, ctx) {
      if (!shouldEmitPolicyEvaluated(decision, process.env)) return;
      const envelope = policyEvaluatedEvent(request, decision, {
        correlationId: ctx.correlationId,
        idempotencyKey: ctx.idempotencyKey,
        eventId: newAuditId(),
      });
      const stored = await eventStore.append(envelope);
      envelope.eventId = stored.eventId;
      envelope.seq = stored.seq;
      await dispatch(envelope);
    },
  };

  // Thread the per-request correlation id into the catalog query deps so
  // any downstream cache writes / log lines / error envelopes can carry it
  // (Invariant I5). The catalog query handlers currently only read
  // projections; propagation here is logging-only today, but reserves the
  // slot for future cache-write / telemetry call sites without another
  // signature change.
  const catalogDeps: CatalogQueryDeps = {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    correlationId,
    projections,
    search,
  };

  const contentPagesDeps: ContentPagesQueryDeps = {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    correlationId,
    entities,
    relations,
  };

  const identityDeps: IdentityQueryDeps = {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    correlationId,
    entities,
    relations,
  };

  return {
    ingress,
    catalogDeps,
    contentPagesDeps,
    identityDeps,
    principal: enrichedPrincipal,
  };
}

/**
 * Layer `userId`, `roles`, `attributes` onto the `Principal` from the
 * tenant's Identity records.
 *
 * Rules:
 *   - JWT auth: `principalId` is the IDP `sub`; look up User where
 *     `primaryIdpSubject = principalId`.
 *   - Test-auth (X-Debug-Principal): `principalId` is treated as the
 *     User's id directly (or the bare service-principal id). The lookup
 *     by IDP subject still runs first so debug principals injected via
 *     a real OIDC pathway also resolve.
 *   - No User match → `userId=null`, `roles=[]`, `attributes={}`. The
 *     request is allowed to proceed; authz denies whatever needs RBAC.
 */
async function enrichPrincipal(
  principal: Principal,
  entities: import('@atlas/ports').EntityStore,
  cache: PrincipalCache,
): Promise<Principal> {
  const cached = cache.get(principal.tenantId, principal.principalId);
  if (cached !== undefined) return cached;

  // Lookup-by-IDP-subject first (the JWT path); fall back to direct
  // User-id lookup if the principalId happens to match a User entity_id
  // (debug-principal path).
  let user = await findUserByIdpSubject(
    entities,
    principal.tenantId,
    principal.principalId,
  );
  if (!user) {
    const direct = await import('@atlas/identity').then(function (m) { return m.getUserEntity(entities, principal.tenantId, principal.principalId); },
    );
    user = direct;
  }
  if (!user) {
    const enriched: Principal = {
      ...principal,
      userId: null,
      roles: [],
      attributes: {},
    };
    cache.set(principal.tenantId, principal.principalId, enriched);
    return enriched;
  }
  const membership = await getMembershipEntity(
    entities,
    principal.tenantId,
    user.userId,
  );
  const enriched: Principal = {
    ...principal,
    userId: user.userId,
    roles: membership?.status === 'active' ? [...membership.roles] : [],
    // Surface a curated subset of User attrs to ABAC. The full User
    // doc carries internal fields (passwordHash, lockedUntil) that
    // Cedar should never see — keep the projection narrow.
    attributes: {
      email: user.email,
      ...(user.givenName !== undefined ? { givenName: user.givenName } : {}),
      ...(user.familyName !== undefined ? { familyName: user.familyName } : {}),
      userStatus: user.status,
      ...(membership?.status !== undefined
        ? { membershipStatus: membership.status }
        : {}),
    },
  };
  cache.set(principal.tenantId, principal.principalId, enriched);
  return enriched;
}
