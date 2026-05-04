# Atlas Request Lifecycle

The 5-minute end-to-end read for an agent told **"work on a capability across
the stack."** This is the canonical trace from a frontend interaction through
the backend pipeline and back. Every other CLAUDE.md links here for the full
picture; this is the only place it's spelled out.

## Two paths

Atlas has a strict CQRS-style split:

- **WRITE path** — frontend submits an *intent*, backend validates / authorizes
  / dispatches it to a handler, the handler emits *events*, the dispatcher
  chain rebuilds *projections* and invalidates the *cache*.
- **READ path** — frontend queries a tenant-scoped projection key; the cache
  serves it if hot, otherwise the projection store does.

Both paths share the same single ingress (`apps/server`, Invariant **I1**)
and the same tenant-scoping (Invariants **I7**, **I9**).

## WRITE path (10 steps)

The path splits into a **synchronous request leg** (steps 1–9) and an
**asynchronous worker leg** (steps 10–13).

### Request leg (returns 202 to caller)

| # | What | Where |
|---|------|-------|
| 1 | Frontend surface (`AtlasSurface`) collects user input and calls `backend.mutate('/intents', { actionId, ... })` | `apps/admin/src/features/.../*.ts` |
| 2 | `@atlas/api-client` HTTP wrapper builds the `IntentEnvelope` (eventId, schemaId derived from actionId, correlationId, idempotencyKey, tenantId, payload) and POSTs it | `packages/api-client/src/http/index.ts` |
| 3 | Server route parses the body and stamps missing `correlationId`/`principalId` from middleware, then calls `submitIntent(...)` | `apps/server/src/routes/intents.ts:27` |
| 4 | The ingress pipeline runs in strict order: principal match → tenant match → schema validation → idempotency-key check → action lookup | `packages/ingress/src/submit-intent.ts:80-160` |
| 5 | `policyEngine.evaluate(...)` runs **before any side effect** (Invariant **I2**). Deny throws `UNAUTHORIZED` (403). Audit emit hook fires fire-and-forget regardless of decision | `packages/ingress/src/submit-intent.ts:203, 226` |
| 6 | Handler dispatch: `state.handlers.get(actionId).handle(ctx, envelope)` returns `{ primary, follow }` events | `packages/ingress/src/submit-intent.ts:258-267` |
| 7 | Handler emitted events carry `cacheInvalidationTags` — handwritten by the handler (e.g. `['Tenant:t1', 'Page:pg_42']`) | `modules/content-pages/src/handlers/page-create.ts:71` |
| 8 | Events are appended to `EventStore` durably. The store is the worker's feed — no separate outbox | `packages/ingress/src/submit-intent.ts` (writes via handler context) |
| 9 | Route responds **202** with `{ eventId, tenantId, principalId }`. The caller's request is now done; projections are not yet rebuilt | `apps/server/src/routes/intents.ts:78` |

### Worker leg (asynchronous, post-response)

| # | What | Where |
|---|------|-------|
| 10 | The worker's `WorkerSource.subscribe(...)` loop wakes on `LISTEN/NOTIFY` (Postgres) or `BroadcastChannel` (IDB / Web Worker) and reads new events past its per-`(module, tenant)` cursor | `apps/projection-worker/` (planned), [`worker.md`](worker.md) |
| 11 | Worker runs the **module dispatcher chain** for each event: catalog → content-pages → `cacheTagDispatcher(cache)` → `policyCacheDispatcher` (cedar only) → `serverEventDispatcher` (SSE). Same composition that ships the request today | currently `apps/server/src/middleware/state.ts:118-134`; moves to worker in phase 3 |
| 12 | Each module dispatcher rebuilds its projections (writes to `ProjectionStore`). `cacheTagDispatcher` reads `envelope.cacheInvalidationTags` and calls `cache.invalidateByTags(tags)`. `serverEventDispatcher` publishes `projection.updated` to SSE/WS subscribers — runs last so subscribers see settled state | `modules/<x>/src/dispatch.ts`, `ports/src/dispatcher.ts:70-76`, `apps/server/src/events/dispatcher.ts` |
| 13 | Worker `ack`s the cursor on chain success; on failure, retries with backoff and (after N retries) advances past the event into a dead-letter queue. Cursor lag is exposed as a metric | [`worker.md`](worker.md) — Operational concerns |

> **Runtime flag (2026-05-03):** the async worker leg is in place
> (`apps/projection-worker/` server-side, `apps/sim/src/worker/` for the
> browser sim). The leg is gated on `WORKER_MODE=async` (server) and
> `VITE_BDD=true` (sim). Defaults stay inline so the cut-over is
> reversible — see [`worker.md`](worker.md).

### Frontend reconciliation after a write

Because the request returns before projections settle, frontend reads
right after a write may see stale data. Three patterns layer on top
([`worker.md`](worker.md#frontend-implications) for detail):

- **SSE-driven refetch (baseline)** — surfaces declare resource tags they
  care about; `@atlas/api-client` subscribes to `projection.updated` and
  calls `surface.reload()` on hit
- **Optimistic UI** — local view updates immediately on the user's own
  writes; SSE confirmation arrives ms-to-seconds later
- **Long-poll with `expectEventSeq ≥ X`** — for surfaces that cannot
  tolerate stale reads, the query route holds the request until the
  worker cursor passes the expected seq

## READ path (5 steps)

| # | What | Where |
|---|------|-------|
| 1 | Frontend `AtlasSurface.load()` calls `backend.query('/...')` | `apps/admin/src/features/.../*.ts` |
| 2 | `@atlas/api-client` GETs the corresponding server route | `packages/api-client/src/http/index.ts` |
| 3 | Server query route builds a tenant-scoped bundle, calls `evaluateRead(...)` for authz when applicable, then calls the module query function | `apps/server/src/routes/content-pages.ts`, `packages/ingress/src/evaluate-read.ts` |
| 4 | Module query reads from `ProjectionStore` keyed by a tenant-scoped cache key | `modules/<x>/src/queries.ts`, `packages/platform-core/src/cache-key.ts:109-138` |
| 5 | JSON response back to the surface; `AtlasSurface` re-renders | (frontend) |

Cache-key shape:

```
cache:<artifactId>@v<ttlSeconds>:<tenantId>:<...other key parts>:<varyHash>
```

- Tenant ID is always present in a key part (Invariant **I9**).
- `varyHash` includes the user when privacy is `USER` (per-user caching).
- Built deterministically by `cache-key.ts` — never hand-construct keys.

## Invariants enforced along the path

| Invariant | Enforced where |
|-----------|----------------|
| **I1** Single HTTP ingress | The path only exists in `apps/server`. No other app exposes HTTP |
| **I2** Authz before side effects | `policyEngine.evaluate` runs before handler dispatch. On deny the throw runs *before* `state.dispatch(primary)` |
| **I3** Idempotency check | `submit-intent.ts` rejects empty `idempotencyKey`; downstream stores treat duplicate keys as no-ops |
| **I5** correlationId everywhere | Stamped at the route, threaded into every handler context, every event envelope, every audit attachment |
| **I7** Tenant isolation in search | `searchEngine` calls always take `tenantId` (port signature; not optional) |
| **I9** Tenant in cache key | `cache-key.ts` builds keys; tenant is a positional component, not an optional flag |
| **I10** Tag-based cache invalidation | `cacheInvalidationTags` on every event; `cacheTagDispatcher` clears matching keys. **No TTL-based invalidation** |
| **I12** Projections rebuildable from event history | Each module exposes a `rebuild*` function; tests in `modules/*/test/dispatch.test.ts` replay events and assert the same end state |

## Gotchas (things that surprise agents)

1. **The 202 returns before projections settle.** A write that completes is
   only durable in the `EventStore` — the projection / cache state catches
   up asynchronously via the worker. Reads issued immediately after a write
   may see stale data. Frontend uses SSE-driven refetch (or optimistic UI)
   to reconcile; backend integration tests use `harness.settle()` to wait
   on the worker explicitly. See [`worker.md`](worker.md).

   *Runtime flag:* gated on `WORKER_MODE=async` (server) and `VITE_BDD=true`
   (sim). Default still inline — flip the flag to switch.

2. **`cacheInvalidationTags` are handwritten.** No automatic tag derivation
   from the event type or resource. If a handler emits an event without tags,
   nothing in the cache gets cleared even if the projection state changes.
   Always emit at least `Tenant:<tenantId>` plus a per-resource tag like
   `Page:<pageId>`. The worker's `cacheTagDispatcher` reads these to know
   what to purge.

3. **Audit emit is fire-and-forget.** Failures in `auditPolicyEvaluated` are
   swallowed (`submit-intent.ts:232-236`). A flaky audit pipeline never blocks
   a request.

4. **Schema ID derives from action ID.** `Foo.Bar.Baz` →
   `foo.bar.baz.v1`. The client never specifies the schema ID; both ends
   compute it. Mismatched action↔schema mapping → 400.

5. **Reads check authz only when the route calls a `checkXRead` helper.** No
   middleware auto-checks query routes. It's the route author's job. Some
   public-API routes (e.g. catalog browsing) intentionally skip the check.

6. **`ProjectionStore` is the durable KV** (Postgres adapter in prod, IDB in
   browser sim). The cache layer is **separate** — when tags fire, only cache
   entries are cleared; the projection itself persists.

7. **Per-env audit emission** (`AUDIT_EMIT_PERMITS`) is read **once at wiring
   time**, not per-request. Toggle it server-wide; don't expect per-request
   conditional behavior.

## What an agent must do for a new capability

Cross-stack contract — every capability needs all of these.

### Backend

- **Handler** in `modules/<domain>/src/handlers/<action>.ts`. Takes an
  `IntentHandlerContext` and a typed command, returns `{ envelope, ... }`. The
  envelope MUST include `cacheInvalidationTags`.
- **Projection rebuilders** in `modules/<domain>/src/projections/`. One per
  read-model the capability touches.
- **Dispatcher wiring** in `modules/<domain>/src/dispatch.ts` — matches event
  types to projection rebuilds. Composed into the server's chain in
  `apps/server/src/middleware/state.ts`.
- **Query function** in `modules/<domain>/src/queries.ts` — reads from
  `ProjectionStore` with a tenant-scoped key.
- **Action manifest** entry so the control-plane registry knows about the
  action and the schema validator can find the JSON schema.
- **Schema** in `specs/schemas/contracts/<action>.schema.json` (or wherever
  the action's schema lives) — validated at step 4.
- **Server routes** — one for the intent submission (POST `/api/v1/intents`
  is shared; route is the dispatch table) and one per query verb.

### Frontend

- **Page** is an `AtlasSurface`. Don't make it a vanilla custom element — the
  surfaceId machinery and load/error/empty states are what tests rely on.
- **Child elements** extend `AtlasElement`. Bare `HTMLElement` is forbidden.
  Use `strAttr` / `boolAttr` for reflected attributes (no hand-rolled get/set).
- **Primitives** come from `@atlas/design`. New components go there, not into
  the app.
- **Reads** via `backend.query('/...')` (typed by the route shape).
- **Writes** via `backend.mutate('/intents', { actionId, ... })`.
- **State** registered via `@atlas/test-state` so Playwright BDD steps can
  read it through `window.__atlasTest`.

### Specs + tests

- **Capability README** at
  `specs/domains/<domain>/capabilities/<capability>/README.md` (purpose,
  scope, surfaces, dependencies, invariants touched).
- **Features** under
  `specs/domains/<domain>/capabilities/<capability>/features/`. Each `.feature`
  file references the capability spec and the relevant invariants in a
  comment + tags:

  ```gherkin
  # Spec: ../README.md
  # Invariants: I2, I5
  @<domain> @<capability> @<journey>
  Feature: ...
  ```
- **Step defs** under `tests/bdd/steps/<domain>/<capability>/<journey>/` if
  capability-specific, or `tests/bdd/steps/common/` if reusable.

## Where to read next

| If you're working on... | Read |
|-------------------------|------|
| Backend handler, projection, dispatcher | [`modules/CLAUDE.md`](../modules/CLAUDE.md) |
| Port interfaces and adapter wiring | [`ports/CLAUDE.md`](../ports/CLAUDE.md), [`adapters/CLAUDE.md`](../adapters/CLAUDE.md) |
| Server routes / middleware | [`apps/server/CLAUDE.md`](../apps/server/CLAUDE.md) |
| Frontend custom element / surface | [`packages/core/CLAUDE.md`](../packages/core/CLAUDE.md) |
| Custom web component design | [`packages/design/CLAUDE.md`](../packages/design/CLAUDE.md) |
| BDD scenarios, surface state assertions | [`tests/bdd/README.md`](../tests/bdd/README.md) |
| Architecture principles + invariant definitions | [`architecture.md`](architecture.md) |
| Worker design (async leg) — outbox model, WorkerSource port, migration phases | [`worker.md`](worker.md) |
