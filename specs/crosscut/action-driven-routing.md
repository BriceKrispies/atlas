# Atlas Action-Driven Routing — Catch-All Contract

The contract for Atlas's two HTTP catch-alls — the **intent-side** catch-all
(`POST /api/v1/intents`) and the **query-side** catch-all
(`GET/POST /api/v1/queries/:queryId`). Both are kernel-mount surfaces; everything
they dispatch is data — module-registered handlers and module-registered query
functions, looked up by id at request-dispatch time, never captured in a route
closure.

This spec is normative (RFC 2119). It is the operator's and developer's contract
for "adding a new write action / read endpoint should be a module-only edit."
It is referenced by [`always-on.md` §6 Phase 1](always-on.md#§6-staged-path) (the
phase that lands both catch-alls) and by [`architecture.md` I1 / I2 / I17](../architecture.md).

The intent side already exists in code; this spec names the contract both sides
share and the query-side additions. The query side's Phase 0 design doc is at
[`query-catch-all-design.md`](query-catch-all-design.md); the present file is
the durable contract that survives that design doc.

---

## §1 Why both sides are catch-alls

Atlas's `apps/server` is the only HTTP boundary (I1). Adding a new write action
or a new read endpoint that mounts its own route in `apps/server/src/main.ts` or
`apps/server/src/routes/*.ts` is a **kernel touch** per
[`always-on.md` §11.1](always-on.md#§111-when-the-retrospective-fires) — it
requires a process restart to take effect and triggers a §11 retrospective.

Two catch-alls collapse that surface to one mount per side:

- **Intent side** — `POST /api/v1/intents` reads `actionId` from the request
  envelope, looks up the handler in a composed `HandlerRegistry`
  (`controlPlaneRegistry`), runs the full ingress pipeline against it.
- **Query side** — `GET /api/v1/queries/:queryId` (or `POST` for large params)
  reads `queryId` from the path, looks up the descriptor in a composed
  `QueryRegistry`, runs the read pipeline against it.

After Phase 1 ships both, the only legal mounts in `apps/server` are the two
catch-alls (plus operator-surface endpoints under `/api/v1/kernel/...` per
[`always-on.md` §5](always-on.md#§5-operator-surface)). Any other `app.get` /
`app.post` / `app.route` call fires the §11.1 retrospective.

---

## §2 Shared invariants

Both catch-alls MUST satisfy:

- **I1** — they are the only HTTP entry points for tenant-facing traffic. No
  other module or package may expose its own route.
- **I2** — authorization runs before dispatch (intent side: `submitIntent` runs
  `evaluatePolicy`; query side: catch-all runs `evaluateRead` before invoking
  the query function). A deny short-circuits with 403 and emits **no** side
  effects — no event, no cache read, no query execution.
- **I5** — `correlationId` propagates from request envelope through dispatch,
  authz, audit, and back into the response.
- **I12** — projections rebuild from event history alone (intent side only —
  the query side reads projections but does not append events).
- **I17** — every registered action and queryId MUST be reachable from every
  surface (HTTP, `atlasctl`, UI). The catch-all registries are the
  source-of-truth the `atlasctl kernel verify` parity check reads against.

A reload that registers a new action or queryId MUST NOT downgrade any of these
(per [`always-on.md` §4.3](always-on.md#§43-invariant-preservation-across-reload)).

---

## §3 Intent-side catch-all — recap

The intent side already exists. Recap of the contract that the query side
mirrors:

- **Mount:** `POST /api/v1/intents`.
- **Body:** `IntentEnvelope` — `{ actionId, payload, idempotencyKey?, ... }`
  (per [`LEXICON.md` "Intent"](../LEXICON.md#intent)).
- **Registry:** `HandlerRegistry` — port at `ports/src/handler-registry.ts`,
  shape `{ get(actionId): IntentHandler | undefined }`. Per-module registries
  (`identityHandlerRegistry`, etc.) compose into `controlPlaneRegistry` in
  `apps/server/src/middleware/state.ts`.
- **Per-module registration:** each module exports its handler registry; new
  intents register by adding a handler to the module's registry file. No
  `apps/server` edit.
- **Pipeline (PIPE-CMD-001):** `resolveTenant` → `authenticate` → `validate` →
  `authorize` → `enforceQuota` → `checkIdempotency` → `dispatchAction` →
  `handleCommand` → `emitEvent(s)` → `invalidateByTags` → `recordAudit`.
- **Cache invalidation (I10):** intent-side handlers emit events carrying
  `cacheInvalidationTags`; the cache layer purges by tag. This contract is
  unchanged.

---

## §4 Query-side catch-all — normative contract

### §4.1 `QueryRegistry` port

The query side introduces a `QueryRegistry` port at
`ports/src/query-registry.ts`, symmetric with `HandlerRegistry`. Conceptual
shape (the TypeScript file is written by `port-adapter-dev` in its own slice;
this section is the contract the port file MUST realize):

```ts
interface QueryRegistry {
  register(descriptor: QueryDescriptor): void;
  get(queryId: string): QueryDescriptor | undefined;
  list(): ReadonlyArray<QueryDescriptor>;
}

interface QueryDescriptor {
  /** Stable id, `<Domain>.<Resource>.<Verb>` — see §4.3. */
  queryId: string;
  /** Action id the policy engine evaluates against. Usually equals queryId. */
  actionId: string;
  /** Resource shape for the policy request. */
  resource: {
    type: string;
    idFrom: (params: Record<string, unknown>) => string;
  };
  /**
   * Optional cache-key builder. Returns the lookup key, or `null` to opt out
   * of caching. MUST include `ctx.tenantId` literally in its returned string
   * — see §4.6.
   */
  cacheKey?: (ctx: QueryContext, params: Record<string, unknown>) => string | null;
  /** If true, a `null` query result returns 200 with body `null`; default 404. */
  nullIsOk?: boolean;
  fn: QueryFn;
}

interface QueryFn<TParams = Record<string, unknown>, TResult = unknown> {
  (ctx: QueryContext, params: TParams): Promise<TResult | null>;
}
```

Why a descriptor (not `register(queryId, fn)`): queries carry three pieces of
metadata that intents do not — the policy action id, the policy resource
shape, and the cache-key shape. Each must live somewhere the catch-all can
read declaratively; the descriptor is the cleanest home.

### §4.2 `QueryContext` — unified read-side context

Every registered query function receives a single `QueryContext`. The shape:

```ts
interface QueryContext {
  tenantId: string;
  principalId: string;
  correlationId: string;
  logger?: Logger;
  // Adapter ports populated by the wiring layer per request — modules
  // see the port surface, never the adapter implementation.
  entities?: unknown;
  relations?: unknown;
  projections?: unknown;
  search?: unknown;
}
```

The wiring layer (`apps/server/src/middleware/state.ts`'s `buildRequestBundle`)
constructs `QueryContext` once per request and hands the same instance to every
query function the request dispatches.

**Migration contract (binding rule):** Each module's existing `*QueryDeps`
interface (`IdentityQueryDeps`, `CatalogQueryDeps`, `ContentPagesQueryDeps`,
…) is **replaced by the unified `QueryContext`** during the per-module
migration. Query functions widen their signature from
`(deps: <ModuleQueryDeps>, ...positionalArgs) => Promise<T>` to
`(ctx: QueryContext, params: TParams) => Promise<T | null>`. Positional args
move onto the `params` object; the function owns its `params` validation. The
`*QueryDeps` types MAY be retained as internal aliases during the migration
window and MUST be deleted once their module's queries are all on the
registry path. No module's `*QueryDeps` survives Phase 1's completion.

This collapse is a deliberate cost: every query function signature changes.
The benefit is one wiring layer, one descriptor shape, one place to add
read-side instrumentation. The collapse is contract, not preference — a
per-module-deps variant of this contract is rejected (it forks the catch-all's
dispatch shape per module and defeats the substrate's purpose).

### §4.3 `queryId` naming convention

Stable id, shape `<Domain>.<Resource>.<Verb>` — same shape as intent action
ids. Examples:

| Today's hand-mount (where it exists) | queryId |
|---|---|
| `GET /api/v1/identity/memberships` *(no current mount)* | `Identity.Memberships.List` |
| `GET /api/v1/identity/sessions` | `Identity.Sessions.ListOwn` |
| `GET /api/v1/catalog/families/:familyKey` | `Catalog.Family.Get` |
| `GET /api/v1/catalog/families/:familyKey/variants` | `Catalog.Family.GetVariants` |
| `GET /api/v1/catalog/search` | `Catalog.Search` |
| `GET /api/v1/policies` | `Authz.Policy.List` |
| `GET /api/v1/policies/:version` | `Authz.Policy.Read` |
| `GET /api/v1/content-pages` | `ContentPages.Page.List` |
| `GET /api/v1/content-pages/:pageId` | `ContentPages.Page.Get` |

Why mirror intent shape: one vocabulary across read and write, one Cedar
policy schema, one lexicon entry per `(domain, resource, verb)` pair. Authz
policies that already name read actions in this shape (e.g.,
`Authz.Policy.List`) do not fork during migration.

URL-shaped ids (`identity/memberships`), `query.<…>` prefixed ids, and other
variants are explicitly rejected — the URL path already names "this is a
query"; the queryId is the action vocabulary, not a URL repeat.

### §4.4 Request shape

The catch-all accepts **both** verbs at the same path:

- `GET /api/v1/queries/:queryId` — params decoded from the URL querystring
  into a flat `Record<string, unknown>` (numeric strings stay strings; the
  query function owns its parsing).
- `POST /api/v1/queries/:queryId` — params decoded from a JSON request body.

Both verbs share the **same descriptor, dispatch, authz, cache, and audit
path.** A descriptor does NOT declare which verb it accepts — both work for
every registered query. A caller chooses GET when params fit on a URL (CDN
cache-friendly), POST when params don't (complex filters, multi-line bodies).

### §4.5 Authz on read

The catch-all MUST run authorization BEFORE invoking the query function. Order
(I2-preserving):

1. Resolve descriptor by `queryId`. 404 if not registered.
2. Build `QueryContext` (per-request via `buildRequestBundle`).
3. Build `PolicyEvaluationRequest` from descriptor's `actionId`,
   `resource.type`, `resource.idFrom(params)`, principal, correlationId.
4. `await evaluateRead(request, ingress)`.
5. If `decision.effect === 'deny'` → 403 with `UNAUTHORIZED`, return.
   **No cache read, no query execution, no side effect** (I2).
6. Cache lookup if `descriptor.cacheKey?.(ctx, params)` is non-null.
7. On cache miss, call `descriptor.fn(ctx, params)`.
8. If a non-null cacheKey was returned, write result to cache.
9. Map `null` result → 404 unless `nullIsOk: true`; otherwise `c.json(result)`.

Audit emission (`StructuredAuthz.PolicyEvaluated`) happens inside
`evaluateRead` — the existing read-audit pathway is reused; no new audit code.

**Bulk-migration audit-volume rule:** Migrating existing hand-mounted read
routes through this catch-all changes observable audit behaviour for read
routes that today bypass `evaluateRead` (notably `catalog/*` and
`content-pages/*`, which trust tenant isolation alone). Each such bulk
migration lands in a **per-module follow-up slice** (one ticket per module),
each with **architect review** for the new audit volume. The query-catch-all
substrate ticket migrates exactly one example route (`Identity.Memberships.List`,
which is a new route — no audit-volume change); broader migration is out of
its scope and out of this contract's scope.

### §4.6 Cache integration (catch-all-owned)

The catch-all owns cache lookup, miss handling, and write-back. Descriptors
declare only the **key shape** via `cacheKey(ctx, params): string | null`.
Returning `null` opts the query out of caching (parity with today's
uncacheable routes).

**Cache key MUST include `tenantId` (I9).** The descriptor's `cacheKey`
function MUST include `ctx.tenantId` **literally in its static returned key
shape**, not conditionally. Concretely:

```ts
// ALLOWED — tenantId is part of every returned key:
cacheKey: (ctx, p) => `Identity.Memberships:${ctx.tenantId}`;
cacheKey: (ctx, p) => `Catalog.Family:${ctx.tenantId}:${p.familyKey}`;

// REJECTED — tenantId is conditional / branched:
cacheKey: (ctx, p) =>
  p.scope === 'global' ? `Catalog.Family:public:${p.familyKey}`
                        : `Catalog.Family:${ctx.tenantId}:${p.familyKey}`;

// REJECTED — opt out is fine, but partial inclusion is not:
cacheKey: (ctx, p) => p.cached ? `key:${ctx.tenantId}` : null; // ALLOWED (uniform when non-null)
```

The registry MUST run a smoke test at `register()` time: it calls `cacheKey`
with a sentinel `QueryContext` and refuses the registration if a non-null
return value does not contain the sentinel `tenantId`. The smoke test catches
the static-key case; the architect gate catches the branching case (any
`cacheKey` implementation containing a conditional return path that varies
whether `tenantId` is included is rejected at review).

The Cache port's invalidation contract (tag-based purges driven by emitted
events' `cacheInvalidationTags` — I10) lives on the write side; the read side
just looks up by key. Centralising lookup in the catch-all means one place for
cache hit/miss metrics and read-side instrumentation.

### §4.7 Backward compatibility during migration

Until each module's read routes migrate, the existing hand-mounted routes in
`apps/server/src/routes/*.ts` continue to work alongside the catch-all on
different URL paths (e.g., `/api/v1/catalog/families/:familyKey` vs.
`/api/v1/queries/Catalog.Family.Get`).

- Hand-mounted read routes MAY emit a debug-level
  `Route.HandMount.Deprecated` log line during the migration window, gated by
  the operator flag `QUERY_CATCHALL_DEPRECATE_HANDMOUNTS` (default `false`).
  When enabled, every hand-mounted read route logs
  `{ event: 'Route.HandMount.Deprecated', properties: { path, suggestedQueryId } }`.
- `vision-keeper`'s monthly audit consumes the signal and files a
  `type: drift-finding` ticket if the same hand-mount appears three audits in
  a row, so migration converges without a hard deadline.
- **No URL alias / redirect.** A request to a hand-mounted URL hits the
  hand-mount; a request to the catch-all URL hits the catch-all. There is no
  mid-flight rewrite; clients adopt either path explicitly.

---

## §5 Operator surface — parity check

`atlasctl kernel verify` (per [`always-on.md` §10](always-on.md#§10-conformance))
MUST verify that every registered `actionId` AND every registered `queryId` is
reachable from every surface I17 names (HTTP, CLI, UI). A handler registered in
a module's `*HandlerRegistry` but missing from the action registry, or a
descriptor registered in a module's `*QueryRegistry` but missing from the
`atlasctl query list` output, MUST be flagged.

`atlasctl query run <queryId> --param key=value` and `atlasctl query list` are
deferred to a follow-up ticket (`tickets/atlas-on-atlas/atlasctl-query-parity.md`),
mirroring the intent side's separate `atlasctl intent send` ship. I17 parity is
considered, named explicitly, and deferred with a written justification — that
satisfies the substrate ticket's acceptance bar.

---

## §6 Anti-patterns

- **Hand-mounting a new read route in `apps/server/src/routes/*.ts` after
  Phase 1 lands.** Triggers §11.1 retrospective; no exception for "this one
  doesn't fit the catch-all" — if it doesn't fit, the descriptor shape needs
  evolving, not a one-off mount.
- **Branching `cacheKey` implementations that conditionally include
  `tenantId`.** Fails the architect review. The static key shape MUST always
  include `tenantId`.
- **Per-module `*QueryDeps` that survive Phase 1's migration.** The contract
  is the unified `QueryContext`; module-local query-deps types are migration
  artifacts only.
- **Bypassing `evaluateRead` for "performance" or "internal" reads.** I2
  applies uniformly. The descriptor is allowed to declare a public action that
  Cedar permits broadly; the runtime path always evaluates.
- **A `queryId` that does not match `<Domain>.<Resource>.<Verb>`.** Rejected
  at registration; the registry MUST validate the shape.

---

## §7 Conformance

- **Architect gate:** verifies (a) no new hand-mount in `apps/server` after
  Phase 1; (b) every registered query's `cacheKey` (when non-null) includes
  `tenantId` literally and without branching; (c) bulk-migration tickets for
  catalog / content-pages reads name the new audit volume explicitly and are
  reviewed before merge.
- **SDET adversarial pass:** asserts (a) a synthetic query registered in a
  module registry is reachable through `GET /api/v1/queries/<id>` with no
  `apps/server` edit; (b) `evaluateRead` deny short-circuits with 403 and no
  cache read; (c) cache hit/miss paths exercise the descriptor's `cacheKey`
  uniformly.
- **BDD scenario** under `tests/bdd/features/always-on/` exercises the
  catch-all dispatch path for at least one intent and one query and asserts
  the I17 parity check via `atlasctl kernel verify`.

Drift findings here become `type: drift-finding` tickets per
[`tickets/CLAUDE.md`](../../tickets/CLAUDE.md).
