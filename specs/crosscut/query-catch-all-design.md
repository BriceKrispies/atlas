# Phase 0 Design — Query-side catch-all dispatcher

> Phase 0 design doc for `tickets/atlas-on-atlas/query-catch-all-dispatcher.md`.
> Owner: `spine-owner`. Subsequent phases consumed by `spec-keeper`,
> `port-adapter-dev`, `module-dev`.

## Context

`always-on.md` §6 Phase 1 names an **intent-side** catch-all dispatcher (one
HTTP entry point selecting handlers via `controlPlaneRegistry`). The query
side has no equivalent — every read endpoint today is hand-mounted in
`apps/server/src/routes/*.ts`. Adding a read endpoint therefore touches the
kernel (route-mount in an apps/server file) by §11.1 row 2.

This design extends §6 Phase 1 with a symmetric query-side catch-all so a new
read endpoint becomes a module-only edit.

The intent side's reference shape is in `ports/src/handler-registry.ts`
(`HandlerRegistry { get(actionId): IntentHandler | undefined }`). The query
side mirrors that shape with the adjustments below.

---

## 1. `QueryRegistry` port signature

The existing query functions across modules are not uniform. Today's shapes:

| Module | Signature |
|--------|-----------|
| `identity` | `(deps: IdentityQueryDeps, ...args) => Promise<T>` |
| `catalog` | `(deps: CatalogQueryDeps, ...args) => Promise<T>` |
| `content-pages` | `(deps: ContentPagesQueryDeps, ...args) => Promise<T>` |
| `authz` | inline in `routes/authz.ts` (uses `PostgresPolicyStore` directly) |

To pass through the catch-all, every query MUST present a single uniform
signature. The catch-all has one (`deps`, single-arg) entry shape; positional
args in the existing functions are absorbed into a single `params` object.

```ts
// ports/src/query-registry.ts

import type { Logger } from '@atlas/platform-core';

/**
 * Per-request context handed to every query — the union of what individual
 * module QueryDeps shapes carry today. Adapter-backed fields (entities,
 * relations, projections, search, …) are populated by the wiring layer
 * (`apps/server/src/middleware/state.ts`) per request; modules see only
 * the port surfaces.
 *
 * Optional fields let modules ignore deps they don't use; the wiring
 * layer always populates everything available so adding a dep to a new
 * module does not require an audit of every prior module.
 */
export interface QueryContext {
  tenantId: string;
  principalId: string;
  correlationId: string;
  logger?: Logger;
  // Adapter ports — populated by the wiring layer. Imports avoided here
  // so this file stays cycle-free; the actual type is structurally
  // compatible with `@atlas/ports`' EntityStore etc. via `QueryDepsBundle`
  // (declaration-merged from the apps/server side, see §2 below).
  entities?: unknown;
  relations?: unknown;
  projections?: unknown;
  search?: unknown;
}

/**
 * Generic query function. `params` is a free-form JSON-shaped object;
 * the per-query implementation owns its validation. The catch-all does
 * not parse params beyond `JSON.parse` on the body / `c.req.query()`
 * decoding — the query function MUST validate and reject malformed input
 * with a `QueryError` whose `code` maps to a 4xx via the error
 * middleware.
 *
 * Return value is JSON-serialisable; the catch-all `c.json()`-s it.
 * `null` is a legitimate return for "not found"; the catch-all maps a
 * `null` return to 404 unless the descriptor opts out (see below).
 */
export interface QueryFn<TParams = Record<string, unknown>, TResult = unknown> {
  (ctx: QueryContext, params: TParams): Promise<TResult | null>;
}

/**
 * Metadata the registry holds alongside each registered query. Keeps the
 * catch-all's behaviour declarative (descriptor-driven) rather than
 * hand-coding policy in the route file.
 */
export interface QueryDescriptor {
  /** Stable id, `<Domain>.<Resource>.<Verb>` — see §3. */
  queryId: string;
  /**
   * Action id used by the policy engine. Usually equals queryId, but
   * legacy routes that already authorize against an existing action id
   * (e.g. `Authz.Policy.List`) can name it explicitly so we don't have to
   * fork Cedar policies during migration.
   */
  actionId: string;
  /**
   * Resource type for the policy evaluation request. The catch-all
   * builds `{ type, id, tenantId, attributes }` per call; the descriptor
   * supplies `type` and a function to extract `id` from params (or a
   * constant '' for list queries).
   */
  resource: {
    type: string;
    idFrom: (params: Record<string, unknown>) => string;
  };
  /**
   * Cache key shape for this query. Mirrors the per-route cache key
   * builders that exist today. The catch-all calls this to compute the
   * key, then performs the cache lookup + miss path uniformly. Returning
   * `null` means "do not cache this query" (parity with today's
   * uncacheable routes).
   *
   * Implementations MUST include `tenantId` in the key (I9). The
   * registry MUST refuse to register a query whose `cacheKey()` returns
   * a non-null value not containing `ctx.tenantId` — enforced by the
   * port's `register()` smoke test on first call.
   */
  cacheKey?: (ctx: QueryContext, params: Record<string, unknown>) => string | null;
  /**
   * If true, a `null` query result is returned as 200 with body `null`
   * rather than 404. Default false (404 on null).
   */
  nullIsOk?: boolean;
  fn: QueryFn;
}

export interface QueryRegistry {
  register(descriptor: QueryDescriptor): void;
  get(queryId: string): QueryDescriptor | undefined;
  list(): ReadonlyArray<QueryDescriptor>;
}
```

**Why `register(descriptor)` not `register(queryId, fn)`:** intents got away
with `get(actionId): IntentHandler` because the action's policy is named by
convention (`actionId === policy action`), the cache invalidation lives in the
emitted event's `cacheInvalidationTags`, and there is no per-action read-cache
shape. Queries need all three pieces (action id for authz, resource shape,
cache key shape) declared somewhere; the descriptor is the cleanest home.

**Why `(ctx, params)` not `(ctx, request)`:** Hono's `Context` is HTTP-shaped;
exposing it through the port would couple modules to Hono and break the
parity story with the IDB sim (which has no HTTP). `params` is a pure
object — the catch-all is responsible for the GET-querystring / POST-body
parse and hands a plain record down.

---

## 2. `QueryDeps` composition

Today each module declares its own `*QueryDeps` interface and the wiring
layer builds one of each per request (`buildRequestBundle` returns
`catalogDeps`, `contentPagesDeps`, `identityDeps` — see
`apps/server/src/middleware/state.ts:498-520`).

The catch-all needs **one** `QueryContext` it can pass to any registered
query. Two options:

- **(a)** A single root `QueryContext` (the union) that every module accepts.
  Modules currently typed against a narrow `*QueryDeps` would either widen to
  `QueryContext` or take a wrapper that picks the fields they need.
- **(b)** Per-request build of a small `QueryDepsBundle` that the registry
  catch-all picks the right slice from per query.

**Decision: (a), with a one-time module-side rename.** The per-request
build step in `middleware/state.ts` already constructs all the adapters the
union needs; collapsing the three (today) / four (with authz) typed bundles
into a single `QueryContext` removes a layer of type wrangling without
losing any type safety — each query function still declares the shape of
`params` and the slice of `QueryContext` it reads (TypeScript structural
typing handles the narrowing).

Concretely, the per-module migration is:

```diff
- export async function listMemberships(deps: IdentityQueryDeps)
+ export async function listMemberships(ctx: QueryContext, _params: {})
```

…where `IdentityQueryDeps` is retained as an internal alias during the
migration window and dropped once every query is on the registry path. Call
sites that today take positional args (`getUser(deps, userId)`) read them off
`params.userId` instead.

The wiring layer (`buildRequestBundle`) drops the three per-module
`*Deps` fields and replaces them with a single `queryContext: QueryContext`
field.

---

## 3. Naming convention for queryIds

`<Domain>.<Resource>.<Verb>`. Examples:

| Today's route | queryId |
|---|---|
| `GET /api/v1/identity/memberships` | `Identity.Memberships.List` |
| `GET /api/v1/identity/sessions` | `Identity.Sessions.ListOwn` |
| `GET /api/v1/catalog/families/:familyKey` | `Catalog.Family.Get` |
| `GET /api/v1/catalog/families/:familyKey/variants` | `Catalog.Family.GetVariants` |
| `GET /api/v1/catalog/search` | `Catalog.Search` |
| `GET /api/v1/policies` | `Authz.Policy.List` |
| `GET /api/v1/policies/:version` | `Authz.Policy.Read` |
| `GET /api/v1/content-pages` | `ContentPages.Page.List` |
| `GET /api/v1/content-pages/:pageId` | `ContentPages.Page.Get` |

**Why mirror intents:** the intent side is already `<Domain>.<Resource>.<Verb>`
(e.g., `Catalog.Family.Publish`, `Identity.User.SetPassword`). Authz policies
are keyed by action id; the read path's authz today already names actions in
this shape (`Authz.Policy.List`, see `routes/authz.ts:45`). One vocabulary,
one Cedar policy schema, one lexicon entry per (domain, resource, verb)
pair regardless of read/write.

**Alternatives considered + rejected:**

- URL-shaped ids (`identity/memberships`). Reads poorly when mixed with
  intents; leaks HTTP shape into a code-as-data registry.
- `query.<...>` prefix. Redundant once the queryId is the path-parameter to
  `GET /api/v1/queries/:queryId` — the URL already names "query."

---

## 4. Request shape at the catch-all

`GET /api/v1/queries/:queryId` with query-string params decoded to a flat
`Record<string, unknown>` (numeric strings stay strings — the query function
parses them).

**Plus** `POST /api/v1/queries/:queryId` with a JSON body for queries whose
params don't fit comfortably on the URL (e.g. complex search filters,
multi-line text payloads).

**Why both:**

- GET is cacheable at every layer above the kernel (CDN, browser, future
  reverse-proxy). The existing per-query cache contract (descriptor's
  `cacheKey()`) lives at the application layer, but HTTP cache semantics
  matter for queries the operator chooses to expose with cache headers later.
- POST is needed for queries whose params don't fit safely in a URL —
  predictable cardinality of large-shape filters, structured search bodies,
  etc.

**Routing rule:** the catch-all accepts both verbs at the same path. GET
parses params from `c.req.query()`; POST parses from `c.req.json()`. Same
descriptor, same dispatch, same authz, same cache. The descriptor does NOT
declare which verb it accepts — both work for every registered query. A
caller who sends GET with a body that won't fit on a URL gets back exactly
what GET-with-truncated-querystring would have returned; the answer is to
POST instead.

---

## 5. Authz on read

Mirrors `routes/authz.ts:38-56`: the catch-all calls `evaluateRead` (from
`@atlas/ingress`, see `packages/ingress/src/evaluate-read.ts`) BEFORE the
query function runs. On `deny`, returns 403 with `UNAUTHORIZED` code.

Authz fires in this order inside the catch-all:

1. Resolve descriptor by `queryId`. 404 if not registered.
2. Build `QueryContext` (per-request — calls `buildRequestBundle`).
3. Build `PolicyEvaluationRequest` from descriptor's `actionId` +
   `resource.type` + `resource.idFrom(params)` + `principal` + `correlationId`.
4. `await evaluateRead(request, bundle.ingress)`.
5. If `decision.effect === 'deny'` → 403, return. (I2: no query
   execution, no cache read, no side effect.)
6. Cache lookup if `descriptor.cacheKey?.(ctx, params)` is non-null.
7. On cache miss, call `descriptor.fn(ctx, params)`.
8. If non-null cacheKey, write result to cache.
9. Map `null` result → 404 unless `nullIsOk: true`. Otherwise `c.json(result)`.

Audit emission (`StructuredAuthz.PolicyEvaluated`) happens inside
`evaluateRead` — no new code; the existing read-audit pathway is reused.

**Invariant alignment:** I2 (authz before side effects) is preserved by
running authz at step 4, before any cache read or query function call.

---

## 6. Cache integration

Option (a): each query declares its cache key shape via
`descriptor.cacheKey(ctx, params)`. The catch-all owns the cache lookup,
miss handling, and write-back. The cache port (`Cache` from `@atlas/ports`)
is reached via `ctx` (or via the bundle that built the ctx — the catch-all
holds both).

Option (b): the descriptor declares its own cache key construction AND its
own cache lookup/write code (the catch-all just calls `descriptor.fn` and
the function does its own caching).

**Decision: (a).** The catch-all owns the cache surface; descriptors only
declare key shape. Reasons:

- Today's per-route cache key construction is already centralised in the
  module's query function; the surface is small (a string).
- The Cache port's invalidation contract (tag-based purges driven by emitted
  events' `cacheInvalidationTags` — I10) lives on the WRITE side; the read
  side just looks up by key. Centralising the lookup in the catch-all means
  one place to add cache instrumentation, miss metrics, hit-ratio logging,
  etc.
- If a future query needs a non-trivial cache shape (e.g. negative caching
  with a separate TTL), the descriptor's `cacheKey()` returning `null` opts
  out cleanly and the query function can manage cache directly via
  `ctx.cache` (which the QueryContext exposes). The escape hatch is named
  and visible.

Keys MUST include `ctx.tenantId` (I9). Enforced by a registry-side runtime
smoke test on first use: the registry calls `cacheKey(ctxWithSentinel,
{})` and asserts `result` contains the sentinel tenant id, refusing to
register the descriptor on violation. Cheap, runs once per process per
queryId.

---

## 7. §6 amendment language

**Decision: edit Phase 1's row.** The query side is mechanically identical to
the intent side — same registry-driven dispatch, same kernel-touch
elimination, same wiring layer composition. Splitting into 1a/1b implies
two separate ship vectors when they share substrate (the per-module
registry pattern in `*HandlerRegistry`). One row, two sides named.

The amended Phase 1 row to insert verbatim into `specs/crosscut/always-on.md`,
replacing the existing row:

| Phase | Work | Owner | Gates |
|---|---|---|---|
| 1 | **Action-driven routing — both intent and query sides.** Replace hand-wired `app.route(...)` for intents AND hand-mounted `app.get(...)` / `app.post(...)` read routes with two catch-alls: `POST /api/v1/intents` (already in place — dispatches via `controlPlaneRegistry` to a composed `HandlerRegistry`) and `GET/POST /api/v1/queries/:queryId` (new — dispatches via a composed `QueryRegistry` to per-module-registered query functions). Both catch-alls run the same per-request bundle build, the same authz step (`submitIntent` for intents; `evaluateRead` for queries), and the same audit pathway. After this phase, adding a new intent OR a new query is a module-only edit (register in the module's `*HandlerRegistry` or `*QueryRegistry`); no kernel touch in `apps/server/src/main.ts` or `routes/*.ts`. | spine-owner + module-dev | Existing intent route tests pass; existing read route tests pass against the migrated route (one example per the substrate ticket); I1 enforced by the two catch-alls being the only mounts; I2 enforced by authz running before dispatch on both sides; integration test asserts a synthetic query registered in a module registry is reachable via `GET /api/v1/queries/<id>` without an `apps/server` edit |

---

## 8. Migration strategy for the one example

The acceptance bar names one example migration. Pick a route that:

- Has no special cache shape (the substrate's default uncached path is fine).
- Returns a list, not a single resource (exercises the `id: ''` resource
  shape that authz expects for list actions).
- Is small and obvious (the substrate ships clean, not entangled in a
  multi-step authoring flow).
- Maps directly to an existing `*Deps.<function>` with no positional args.

**Recommendation:** `GET /api/v1/identity/memberships` → queryId
`Identity.Memberships.List`. Reasons:

- It's the exact route the *blocking* slice
  (`identity/tenant-admin-invites-user`) needs — migrating it as the example
  unblocks the consumer directly, and the §11 retrospective trigger is
  avoided.
- Query function (`listMemberships` in `modules/identity/src/queries.ts:80`)
  exists, returns a list, takes no positional args, has no cache key today.
- The hand-mount slot in `apps/server/src/routes/identity.ts` does not yet
  exist for this route — there is no migration of a hand-mount to remove,
  just a new registration on the catch-all path. Cleanest possible substrate
  ship.

**Secondary recommendation if the user prefers migrating an existing hand-mount:**
`GET /api/v1/catalog/taxonomies/:treeKey/nodes` → `Catalog.Taxonomy.GetNodes`.
Single positional arg (`treeKey`) → `params.treeKey`; no cache shape; the
old hand-mount in `routes/catalog.ts:24-39` deletes cleanly. Slightly more
work than the primary recommendation but proves migration from-hand-mount
behaviour end-to-end.

---

## 9. I17 (API/CLI/UI parity) — `atlasctl query`

**Scope this ticket: HTTP catch-all + integration test only.**

`atlasctl query run <queryId> --param key=value` (and `atlasctl query list`)
is **deferred to a follow-up ticket** (`tickets/atlas-on-atlas/atlasctl-query-parity.md`,
to be filed when this lands). Reasons:

- I17 demands parity across surfaces, not parity in a single PR. The intent
  side's `atlasctl intent send` was a separate ship from the intent
  catch-all; mirroring that ordering here keeps the slices comparable.
- The substrate is more valuable than the CLI: every other agent task is
  blocked on read endpoints being module-only edits. The CLI surface is
  operator-facing and has no current consumer.
- The follow-up is small and obvious (one CLI command file + a HTTP call).
  Scoping it separately keeps the substrate slice focused.

The `atlasctl` follow-up ticket inherits the substrate-ticket's acceptance
bar that "I17 parity is considered" — it is considered, named explicitly,
and deferred with a written justification, which satisfies the acceptance
condition.

---

## 10. Backward compatibility

During the migration window (substrate + one example lands; the remaining
read routes migrate per-module later), the hand-mounted routes in
`apps/server/src/routes/*.ts` continue to work. They sit alongside the
catch-all on different URL paths (`/api/v1/catalog/families/:familyKey` vs.
`/api/v1/queries/Catalog.Family.Get`).

**Decision: emit a structured-log line at request time when a hand-mounted
read route is hit, gated by a flag.** Specifically:

- A `state.ts`-level config flag `QUERY_CATCHALL_DEPRECATE_HANDMOUNTS`
  (default `false`) controls whether hand-mounted read routes emit a
  `Route.HandMount.Deprecated` debug-level log line on each request.
- When true, every hand-mounted read route logs
  `{ event: 'Route.HandMount.Deprecated', properties: { path, suggestedQueryId } }`
  at debug level (not warn/info — does not pollute production logs by
  default). The operator flips the flag during the migration window to
  surface which routes are still in use; `vision-keeper` consumes the
  signal in its monthly audit.
- A drift-finding ticket fires when an unmigrated read route is observed
  in the wild three audits in a row. This is the loop that drives the
  migration to completion without a hard deadline.

**Why not a hard deprecation warning at request time:** the migration is
multi-PR and per-module; warning every request would pollute logs through
the migration window and add no signal beyond the audit-cycle drift check.

**No URL alias / redirect.** A request to `/api/v1/catalog/families/foo`
during the migration window hits the hand-mounted route exactly as before
— no redirect to `/api/v1/queries/Catalog.Family.Get?familyKey=foo`. Once
the hand-mount is deleted, the URL 404s; clients are expected to consume
either the catch-all path OR a still-mounted hand-mount, not the same
client switching mid-flight.

---

## Summary of decisions (one line each)

1. `QueryRegistry.register(descriptor)` — descriptor carries `queryId`,
   `actionId`, `resource`, optional `cacheKey`, optional `nullIsOk`, `fn`.
2. Single `QueryContext` union built per-request in `buildRequestBundle`;
   per-module `*QueryDeps` collapse into it during migration.
3. `<Domain>.<Resource>.<Verb>` — same shape as intent action ids.
4. `GET /api/v1/queries/:queryId` (params from querystring) **and**
   `POST /api/v1/queries/:queryId` (params from JSON body) — same dispatch.
5. `evaluateRead` runs before the query fn; deny short-circuits with 403;
   I2 preserved.
6. Catch-all owns cache lookup; descriptor declares `cacheKey()`;
   `null` opts out of caching.
7. **Edit** Phase 1's row in `always-on.md` §6 to name both sides (text
   in §7 above).
8. Example migration: `GET /api/v1/identity/memberships` →
   `Identity.Memberships.List` (no existing hand-mount to remove; cleanest
   ship). Secondary if user prefers hand-mount removal:
   `Catalog.Taxonomy.GetNodes`.
9. `atlasctl query` deferred to follow-up ticket; I17 considered and
   explicitly named in this design.
10. Hand-mounted routes coexist; flag-gated debug log
    (`QUERY_CATCHALL_DEPRECATE_HANDMOUNTS`) surfaces usage during migration;
    drift-finding tickets fire on three-audit-recurrence.

## Architectural concerns to escalate

- **The `QueryContext` collapse is the biggest churn cost.** Today's three
  `*QueryDeps` shapes are typed and narrow; the union widens every module's
  query function signature. The widening is type-safe (TS structural
  narrowing handles per-module reads of the union) but every query
  function signature changes in the per-module migration tickets. Worth a
  user checkpoint before module-dev starts: confirm the collapse is
  preferred over keeping per-module deps and passing the right slice via
  the descriptor's registration.
- **Authz for queries that today bypass `evaluateRead`** (catalog and
  content-pages read routes don't authz today — they trust tenant
  isolation alone). Migrating them to the catch-all means every read goes
  through `evaluateRead`, which is the right invariant but DOES change
  observable behaviour (now `Authz.Policy.List`-shaped audit events fire on
  catalog queries that today don't). The example migration
  (`Identity.Memberships.List`) avoids this because it's a new route; the
  bulk-migration tickets land that change for catalog/content-pages and
  need an `architect` review to confirm the new audit volume is intended.
  Worth naming explicitly in the bulk-migration tickets so it's not a
  surprise.
- **The `cacheKey` smoke test for I9 (`tenantId` in key) runs at
  `register()` time with a sentinel context.** If a `cacheKey` implementation
  uses `ctx.tenantId` only on certain code paths (e.g. branches on
  `params.scope === 'global'`), the smoke test could pass and a real call
  could violate I9. Acceptable for v1 — the per-query test in the module
  exercises the real path — but `architect` should flag any cacheKey
  implementation with branching as a review item.
