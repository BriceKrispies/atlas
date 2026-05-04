# Atlas Projection Worker

The asynchronous side of the Atlas request pipeline. This document is the
**target architecture** — when an agent reads "the worker" anywhere in
specs or routing CLAUDE.mds, this is what they mean.

> **Implementation status (2026-05-03):** phases 1–5 of the migration have
> landed. The worker exists at `apps/projection-worker/` (server side) and
> `apps/sim/src/worker/main.ts` (browser sim mirror). Behaviour is gated on
> two flags so the cut-over is reversible:
>
> - **Server**: `WORKER_MODE=inline` (default) keeps the existing inline
>   chain in `apps/server/src/middleware/state.ts`. `WORKER_MODE=async`
>   no-ops the inline dispatch — the projection-worker drains the event
>   store out-of-band. Flip after observing the worker in shadow mode.
> - **Sim**: `VITE_BDD=true` (set automatically by the BDD harness) routes
>   projections through the Web Worker. Without that flag, sim keeps the
>   inline chain so dev-sandbox iteration stays synchronous.
>
> Phase 6 (per-module worker split) is deferred — it's a deployment shape,
> not new code.

## Why a worker

Projection rebuilds can be expensive — render trees with WASM, large search
re-indexes, multi-table cache fills. Running them inline in the request:

- couples request latency to projection cost (a slow rebuild = a slow 202)
- prevents horizontal scaling of read-model maintenance separately from
  request handling
- forces handlers to choose between "do the work synchronously" and "skip
  cache invalidation" when under pressure — a foot-gun

The worker decouples request handling from read-model maintenance. The
write path commits the event durably and returns; the worker fans the
event out to projections, cache invalidations, and downstream notifiers
on its own clock.

## The model in one paragraph

The **event store is the durable feed**. Handlers append events as today.
A **per-(module, tenant) cursor** tracks how far each module's projection
chain has consumed. The worker reads new events past its cursors, runs the
module dispatcher chain, advances the cursor on success. Triggering uses
**Postgres `LISTEN/NOTIFY`** (sub-100ms wake) with a polling fallback (in
case the notify channel is missed during reconnects). The "feed of new
events" hides behind a **`WorkerSource` port**, so we can swap to Redis
Streams / NATS / Kafka later without touching the worker chain.

There is **no separate outbox table**. The event store is the queue.

## Why event-store-as-feed (not a separate outbox)

A separate outbox table forces dual-writes (event store + outbox) inside
one transaction, then dual-deletes (outbox cleanup + projection cursor).
That's two consistency problems where one will do. Atlas's event store
already meets the outbox requirements:

- Durable (Postgres-backed; tenant-scoped)
- Strictly ordered per tenant (sequence number / `event_seq`)
- Consumed by a single logical reader (the worker)

The cost of using it directly is one column we may need to add: a per-event
`seq BIGINT` (monotonic per tenant) for cursor comparison if it isn't
already there.

## `WorkerSource` port

```ts
// ports/src/worker-source.ts (new)
export interface WorkerSource {
  /**
   * Stream events for one tenant past `afterSeq`. Resolves a generator that
   * yields events in sequence order. Generator stays open and blocks on
   * new events (LISTEN/NOTIFY-driven for Postgres; storage-events-driven
   * for IDB; Redis Streams XREAD BLOCK for Redis; etc.).
   *
   * Caller commits cursor position by calling `ack(seq)`.
   */
  subscribe(tenantId: string, afterSeq: bigint): WorkerSubscription;
}

export interface WorkerSubscription {
  events(): AsyncIterable<EventEnvelope>;
  ack(seq: bigint): Promise<void>;
  close(): Promise<void>;
}
```

Adapters at phase 1:

- **Postgres** (`adapters/node`) — backs onto `event_store`; LISTEN/NOTIFY
  channel `atlas:event_appended:<tenantId>`; cursor table `worker_cursors`
- **IDB** (`adapters/idb`) — backs onto the IndexedDB event store; uses
  `BroadcastChannel` for cross-tab/Web-Worker wake; cursor stored in IDB

Adapters that drop in later (no worker logic change):

- **Redis Streams** — XREAD BLOCK; consumer groups for partition-by-module
- **NATS JetStream** — durable consumer; ack semantics built in
- **Kafka** — consumer group; offset commit per partition

## Worker chain composition

The current `composeDispatchers` chain at
`apps/server/src/middleware/state.ts:118` becomes the **worker's** chain.
Same factories, same order:

```
catalogDispatcher
  → contentPagesDispatcher
  → cacheTagDispatcher(cache)
  → policyCacheDispatcher (cedar)
  → serverEventDispatcher(broadcast)   ← SSE fanout, runs last
```

What changes: the chain runs **after** the request returns, gated on the
worker's `WorkerSource.events()` loop. When a chain run completes, the
worker `ack`s the cursor.

## Single-worker default, per-module-ready

Day one deploys **one worker process per node, with a hot-standby replica
using Postgres advisory locks for leader election**. The active worker
drains all modules' cursors.

The chain is partitioned by module from day one — each module's projection
rebuilders are wrapped in a per-module dispatcher that owns its own
cursor key. Per-module worker split is a **deployment change, not a code
change**:

```
# Day one
1 worker (active) + 1 worker (standby)   ← all modules

# When a single worker can't keep up
N catalog workers, M content-pages workers, 1 audit worker, ...
```

Each per-module worker claims its module's cursor via advisory lock; events
for unclaimed modules are skipped. No coordination needed beyond the lock.

## Browser sim parity (Web Worker)

`apps/sim` runs a Web Worker that mirrors the server worker. Same chain,
same `WorkerSource` interface (IDB adapter), same module composition. The
sim's main thread submits intents to the in-memory ingress; the Web Worker
drains the IDB feed and rebuilds projections.

This matters because BDD scenarios run against the sim. If the sim runs
projections inline but production runs them async, BDD tests will pass
locally and break in production (or vice versa). Web Worker mirroring
keeps the boundary honest in BDD.

## Delivery semantics

**At-least-once with idempotent projections.** Forced by Invariant **I12**
(projections rebuildable from event history) — re-applying an event must
produce the same end state. The worker can replay safely on retry; the
cursor only advances after a chain run commits.

**Failure handling:**

- Chain throws → worker logs, holds cursor, retries with exponential
  backoff (capped at ~30s)
- Persistent failure (>N retries) → event moved to a **dead-letter cursor
  table**; worker advances past it; ops alert fires
- Dead-letter replay is a manual operator action (`atlasctl worker
  replay --tenant T --seq S` or similar — design open)

Exactly-once is **explicitly out of scope**. Projections must tolerate
re-application.

## Frontend implications

A write returns 202 with stale reads still possible. Three patterns,
layered:

1. **SSE-driven refetch (baseline).** Worker emits `projection.updated`
   with the resource tags it just touched. AtlasSurfaces declare which
   tags they care about; an `@atlas/api-client` subscription calls
   `surface.reload()` on hit.
2. **Optimistic UI.** For the local user's writes, the surface updates
   its local view immediately; SSE confirmation arrives ms-to-seconds later.
3. **Long-poll with `expectEventSeq ≥ X`.** For surfaces that genuinely
   cannot tolerate stale reads, the query route holds the request until
   the worker's cursor passes the expected seq. Use sparingly — it's
   request-blocking.

The cut-over to async writes makes the SSE/refetch path mandatory; today
it's nice-to-have because reads are immediately fresh.

## Test strategy

Two settle modes for two test contexts:

- **BDD scenarios** — fixture auto-drain. Each `When` step that submits
  an intent is followed transparently by `await worker.settle()` before
  the next `Then` step runs. Tests assert user-visible behavior; the
  async boundary is incidental.
- **Unit / integration tests** — explicit `await harness.settle()`. Tests
  whose subject *is* the async boundary (worker tests, retry tests, lag
  tests) must call settle deliberately. Forces async-awareness on the
  author.

`harness.settle()` is a test-only API: drains the feed, runs the chain
for all pending events, returns. Implemented in
`@atlas/test-fixtures` for both Postgres and IDB feeds.

## Operational concerns

- **Lag SLO** — worker cursor lag (current head − cursor) is a primary
  health metric. Expose as `atlas_worker_cursor_lag_seconds{module, tenant}`.
- **Liveness** — worker reports a heartbeat every N seconds; missed
  heartbeats fail readiness probes.
- **Backpressure** — if lag exceeds a configurable threshold, the worker
  reports degraded; the ingress can refuse new writes (return 503) once
  lag exceeds a hard ceiling. Default off; opt-in per-tenant.
- **Observability** — every chain run gets a span (`worker.process_event`)
  with `tenantId`, `module`, `eventType`, `seq`. Errors trace to dead
  letter.

## Migration phases

| # | What | Status |
|---|------|--------|
| 0 | Specs (this doc + `lifecycle.md` + revert `architecture.md` notes) | ✅ **Done** |
| 1 | Foundation — `WorkerSource` port + Postgres adapter + IDB adapter + cursor migration + contract tests | ✅ **Done** |
| 2 | Worker process (`apps/projection-worker/`) with shadow-mode wrapper, advisory-lock leader election, tenant-loop orchestration | ✅ **Done** |
| 3 | Server cut-over — `WORKER_MODE=inline\|async` flag in `apps/server`; inline dispatch becomes a no-op when async; `harness.settle()` helper in `@atlas/test-fixtures` | ✅ **Done** (gated on `WORKER_MODE=async`) |
| 4 | Browser sim Web Worker mirror — `apps/sim/src/worker/main.ts`; BDD probe auto-drains via `__atlas_debug.worker.settle()` | ✅ **Done** (gated on `VITE_BDD=true`) |
| 5 | Frontend SSE-driven refetch + optimistic UI helpers — `tags` on the wire, `?tags=` filter, `subscribeTags`, `AtlasSurface.subscribesTo()` | ✅ **Done** |
| 6 | Per-module worker split (when measured-needed) | Deferred |

Phases 0–5 are landed. The spec is now true in code, gated on the two
runtime flags above so the cut-over is reversible. Phase 6 (per-module
worker split) is on-demand, not on the critical path.

## See also

- [`lifecycle.md`](lifecycle.md) — full request lifecycle (WRITE + READ paths)
- [`architecture.md`](architecture.md) — invariants and the bigger picture
- [`ports/CLAUDE.md`](../ports/CLAUDE.md) — port catalogue (the new `WorkerSource` will land here)
- [`apps/server/CLAUDE.md`](../apps/server/CLAUDE.md) — server-side wiring (where the chain composition lives today)
