/**
 * QueryRegistry port — query-side dispatch registry, symmetric with
 * `HandlerRegistry` on the intent side. Maps `queryId` → `QueryDescriptor`.
 *
 * The query-side catch-all (`GET/POST /api/v1/queries/:queryId`) reads a
 * registered descriptor by id and drives authz, cache lookup, and dispatch
 * declaratively from its fields. Per-module query registries compose into a
 * single registry at the wiring layer, mirroring how `*HandlerRegistry`s
 * compose into `controlPlaneRegistry`.
 *
 * Full contract: [`specs/crosscut/action-driven-routing.md`](../../specs/crosscut/action-driven-routing.md) §4.
 * Lexicon entries: `QueryRegistry`, `QueryDescriptor`, `QueryContext`,
 * `QueryFn`, `queryId` in `specs/LEXICON.md`.
 *
 * Touches Invariants I1 (single ingress), I2 (authz before dispatch — owned
 * by the catch-all, not this port), I9 (tenant in cache key — enforced by
 * `register()` smoke check), I17 (every queryId reachable from every
 * surface).
 */
import type { Logger } from '@atlas/platform-core';

/**
 * Per-request context handed to every `QueryFn`. The union of what
 * individual module `*QueryDeps` shapes carried before the action-driven
 * routing Phase 1 migration — see
 * [`specs/crosscut/action-driven-routing.md`](../../specs/crosscut/action-driven-routing.md) §4.2.
 *
 * Built once per request in `apps/server/src/middleware/state.ts`'s
 * `buildRequestBundle`; the same instance is passed to every query the
 * request dispatches.
 *
 * Adapter-port fields (`entities`, `relations`, `projections`, `search`)
 * are typed as `unknown` here to keep the port file cycle-free with the
 * other port files; the wiring layer populates them with the concrete port
 * surfaces, and consumers narrow structurally when they reach in.
 *
 * Optional fields let modules ignore deps they don't use; the wiring
 * layer always populates everything available so adding a dep to a new
 * module does not require an audit of every prior module.
 */
export interface QueryContext {
  /** Tenant whose data the query reads. Required (Invariant I7). */
  tenantId: string;
  /** Authenticated principal making the request. Required for authz. */
  principalId: string;
  /** Request correlation id, propagated end-to-end (Invariant I5). */
  correlationId: string;
  /** Per-request logger. Optional so test fixtures can omit it. */
  logger?: Logger;
  // Adapter ports — populated by the wiring layer. Typed `unknown` to
  // avoid coupling this port file to every adapter-backed port; the
  // wiring layer hands the concrete port surfaces in.
  entities?: unknown;
  relations?: unknown;
  projections?: unknown;
  search?: unknown;
}

/**
 * Generic query function. `params` is a free-form JSON-shaped object;
 * the per-query implementation owns its validation. The catch-all does
 * not parse params beyond the JSON-body / querystring decode — the query
 * function MUST validate and reject malformed input with a `QueryError`
 * whose `code` maps to a 4xx via the error middleware.
 *
 * Return value MUST be JSON-serialisable. `null` is a legitimate "not
 * found"; the catch-all maps a `null` return to 404 unless the
 * descriptor declares `nullIsOk: true`.
 */
export interface QueryFn<
  TParams = Record<string, unknown>,
  TResult = unknown,
> {
  (ctx: QueryContext, params: TParams): Promise<TResult | null>;
}

/**
 * Metadata the registry holds alongside each registered query. Keeps the
 * catch-all's behaviour declarative rather than hand-coding policy in the
 * route file. See
 * [`specs/crosscut/action-driven-routing.md`](../../specs/crosscut/action-driven-routing.md) §4.1.
 */
export interface QueryDescriptor<
  TParams = Record<string, unknown>,
  TResult = unknown,
> {
  /** Stable id, `<Domain>.<Resource>.<Verb>` — PascalCase, dot-separated. */
  queryId: string;
  /**
   * Action id used by the policy engine. Usually equals `queryId`; legacy
   * routes that already authorize against an existing action id can name
   * it explicitly so Cedar policies don't have to fork during migration.
   */
  actionId: string;
  /**
   * Resource shape for the policy evaluation request. The catch-all
   * builds `{ type, id, tenantId, attributes }` per call; the descriptor
   * supplies `type` and a function that extracts `id` from `params`
   * (return `''` for list/collection queries).
   */
  resource: {
    type: string;
    idFrom: (params: Record<string, unknown>) => string;
  };
  /**
   * Optional cache-key builder. Returns the lookup key, or `null` to opt
   * out of caching (parity with today's uncacheable routes).
   *
   * **MUST include `ctx.tenantId` literally in its returned key shape**
   * (Invariant I9). `register()` smoke-checks the static case; branching
   * `cacheKey` implementations that conditionally include `tenantId` are
   * rejected at architect review per §4.6 of the contract.
   */
  cacheKey?: (
    ctx: QueryContext,
    params: Record<string, unknown>,
  ) => string | null;
  /**
   * If true, a `null` query result returns 200 with body `null` rather
   * than 404. Default false (404 on null).
   */
  nullIsOk?: boolean;
  fn: QueryFn<TParams, TResult>;
}

/**
 * Query-side dispatch registry. Symmetric with `HandlerRegistry`.
 *
 * `register()` MUST validate descriptor shape:
 *   - `queryId` MUST match `<Domain>.<Resource>.<Verb>` (PascalCase
 *     segments, dot-separated). Reject otherwise.
 *   - If `cacheKey` is provided, calling it with a sentinel
 *     `QueryContext` MUST return either `null` (uncached) or a string
 *     containing the sentinel `tenantId` literally. Reject otherwise.
 *   - Re-registering an already-registered `queryId` MUST be rejected
 *     (see `createQueryRegistry` below for the default reason).
 */
export interface QueryRegistry {
  /** Register a descriptor. Throws on invalid descriptor or duplicate id. */
  register(descriptor: QueryDescriptor): void;
  /** Look up a descriptor by id. Returns `undefined` if not registered. */
  get(queryId: string): QueryDescriptor | undefined;
  /** Snapshot of all registered descriptors, in registration order. */
  list(): ReadonlyArray<QueryDescriptor>;
}

/**
 * Grammar for `queryId` — `<Domain>.<Resource>.<Verb>`, PascalCase
 * segments. Examples: `Identity.Memberships.List`, `Catalog.Family.Get`.
 *
 * Allows three or four segments so resource-scoped sub-actions
 * (`Catalog.Family.Variants.List`) compile; URL-shaped ids
 * (`identity/memberships`) and `query.*` prefixes do not.
 */
export const QUERY_ID_PATTERN: RegExp = /^[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*){2,3}$/;

/**
 * Sentinel `tenantId` used by the registration-time `cacheKey` smoke
 * check. Chosen to be obviously synthetic so the smoke call cannot
 * collide with a real tenant id under any circumstances.
 */
const SENTINEL_TENANT_ID = '__atlas_registry_smoke_tenant__';

/**
 * Sentinel context handed to `cacheKey()` during the registration smoke
 * check. Other fields are filled in with synthetic values; `cacheKey`
 * implementations that actually read them would only ever do so to
 * compose them into the returned key, which is exactly what we want to
 * inspect.
 */
function makeSmokeContext(): QueryContext {
  return {
    tenantId: SENTINEL_TENANT_ID,
    principalId: '__atlas_registry_smoke_principal__',
    correlationId: '__atlas_registry_smoke_correlation__',
  };
}

/**
 * Build an in-memory `QueryRegistry`. The default implementation used by
 * per-module registries during the action-driven-routing migration; the
 * production wiring composes these per-module instances into one.
 *
 * Exported alongside the port types (mirroring the
 * `InMemoryAnalyticsStore` / `composeDispatchers` pattern in this
 * package) so module code can construct a registry without importing
 * an adapter package.
 *
 * Double-register behaviour: **reject**. Re-registering the same
 * `queryId` throws. Two modules accidentally clobbering each other under
 * a silent-replace policy would surprise the catch-all consumer and is
 * harder to diagnose than a loud registration-time throw. If a future
 * use case needs replace semantics it can be added as an explicit
 * `replace(descriptor)` method; the safer default is reject.
 */
export function createQueryRegistry(): QueryRegistry {
  const byId = new Map<string, QueryDescriptor>();
  const order: QueryDescriptor[] = [];
  return {
    register(descriptor: QueryDescriptor): void {
      validateDescriptor(descriptor);
      if (byId.has(descriptor.queryId)) {
        throw new Error(
          `QueryRegistry: duplicate registration for queryId="${descriptor.queryId}". ` +
            'Re-registration is rejected; pick a distinct queryId or remove the prior registration.',
        );
      }
      byId.set(descriptor.queryId, descriptor);
      order.push(descriptor);
    },
    get(queryId: string): QueryDescriptor | undefined {
      return byId.get(queryId);
    },
    list(): ReadonlyArray<QueryDescriptor> {
      return order;
    },
  };
}

/**
 * Validate a descriptor at registration time. Exported so a composing
 * registry (one that aggregates multiple per-module registries) can
 * apply the same checks without re-implementing them.
 *
 * Checks:
 *   1. `queryId` matches `QUERY_ID_PATTERN`.
 *   2. `actionId` is a non-empty string.
 *   3. `resource.type` is a non-empty string.
 *   4. `resource.idFrom` is a function.
 *   5. `fn` is a function.
 *   6. If `cacheKey` is provided, a smoke call with the sentinel context
 *      returns either `null` or a string containing the sentinel
 *      `tenantId` literally. Catches the static-key case; branching
 *      `cacheKey` implementations are an architect-review concern per
 *      `specs/crosscut/action-driven-routing.md` §4.6.
 */
export function validateDescriptor(descriptor: QueryDescriptor): void {
  if (typeof descriptor.queryId !== 'string' || !QUERY_ID_PATTERN.test(descriptor.queryId)) {
    throw new Error(
      `QueryRegistry: invalid queryId="${String(descriptor.queryId)}". ` +
        'Expected `<Domain>.<Resource>.<Verb>` (PascalCase segments, dot-separated).',
    );
  }
  if (typeof descriptor.actionId !== 'string' || descriptor.actionId.length === 0) {
    throw new Error(
      `QueryRegistry: descriptor for "${descriptor.queryId}" has empty actionId.`,
    );
  }
  if (
    descriptor.resource == null ||
    typeof descriptor.resource.type !== 'string' ||
    descriptor.resource.type.length === 0
  ) {
    throw new Error(
      `QueryRegistry: descriptor for "${descriptor.queryId}" is missing resource.type.`,
    );
  }
  if (typeof descriptor.resource.idFrom !== 'function') {
    throw new Error(
      `QueryRegistry: descriptor for "${descriptor.queryId}" is missing resource.idFrom.`,
    );
  }
  if (typeof descriptor.fn !== 'function') {
    throw new Error(
      `QueryRegistry: descriptor for "${descriptor.queryId}" is missing fn.`,
    );
  }
  if (descriptor.cacheKey !== undefined) {
    if (typeof descriptor.cacheKey !== 'function') {
      throw new Error(
        `QueryRegistry: descriptor for "${descriptor.queryId}" has a non-function cacheKey.`,
      );
    }
    let smoke: string | null;
    try {
      smoke = descriptor.cacheKey(makeSmokeContext(), {});
    } catch (err) {
      throw new Error(
        `QueryRegistry: cacheKey for "${descriptor.queryId}" threw during the ` +
          `registration smoke check: ${(err as Error).message}. ` +
          'cacheKey() MUST tolerate a sentinel context with an empty params object.',
      );
    }
    if (smoke !== null && !smoke.includes(SENTINEL_TENANT_ID)) {
      throw new Error(
        `QueryRegistry: cacheKey for "${descriptor.queryId}" does not include ` +
          'ctx.tenantId in its returned key shape (Invariant I9). ' +
          'Per specs/crosscut/action-driven-routing.md §4.6, cacheKey() MUST include ' +
          'ctx.tenantId literally — branching implementations are also rejected at architect review.',
      );
    }
  }
}
