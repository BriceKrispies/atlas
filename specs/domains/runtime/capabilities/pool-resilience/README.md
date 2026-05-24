# Capability: Postgres Pool Resilience (survive a DB container bounce, no restart)

**Domain:** runtime (platform runtime substrate)
**Capability:** pool-resilience
**Status:** Draft

> **Domain placement note.** This capability is platform *runtime substrate* —
> the connection-management layer behind the `EventStore` / `ProjectionStore` /
> `EntityStore` ports, not a tenant-facing domain. It lands under the
> Spine-adjacent **`runtime`** domain established by the
> [`control-plane-schema-registry`](../control-plane-schema-registry/README.md)
> capability (read that README's domain-placement note for the convention): the
> home for kernel-runtime-substrate slices that make the recursive kernel of
> [ADR 0008](../../../../decisions/0008-atlas-on-atlas.md) survive operations the
> always-on contract demands. It is **not** Compute `runtime` (tenant service
> runtimes) and **not** Extensibility `custom-schema`. If a platform owner
> prefers a `crosscut/` or adapter-local home, that is a one-line `git mv` —
> escalate to `architect` before implementation if contested.

## Purpose

An operator wipes and reseeds the development (or a recovery) Postgres
instance — `make db-reset` (`compose down -v && up`), or `make db-down &&
make db-up`. The Postgres container restarts; every pooled connection a
live `apps/server` holds is now pointed at a process that no longer exists.
Today the next request that touches a stale connection errors, and the
server does not self-heal — the operator must restart the `apps/server`
process to get a healthy pool. That restart contradicts the always-on
contract ("the runtime stays up; behaviour changes by editing data, not by
restarting code", [`always-on.md` §1](../../../../crosscut/always-on.md)) and
trips **I20**: a routine operational event (a DB bounce) forces a code-process
restart. This capability makes both Postgres pool-construction sites — the
control-plane pool and the per-tenant pools — recover automatically after a
Postgres bounce, so the same `apps/server` process (same `bootId`) serves the
next request successfully once Postgres is back.

This is connection-resilience work, **not** a request-pipeline change. No
intent, event, projection, query, route, or UI surface is added or altered.

## Empirical-First Directive (read before any code)

**Do not write reconnection code until you have measured what postgres.js
already does.** `postgres.js` (the `postgres` package, used at both sites)
maintains a connection pool and, by design, re-establishes connections
per-query for transient drops — a query issued after the server it was talking
to went away typically errors *that one query* and then reconnects on the next
attempt. The plausible reality is that **most of the recovery this ticket asks
for already happens**, and the actual gap is (a) explicit, documented
resilience configuration at both construction sites and (b) a regression test
that locks the behaviour in, **not** new reconnection machinery.

The implementer MUST, as the first step, run the empirical probe and record
the result in the slice's ticket log:

1. Bring up Postgres (`make db-up`) and `apps/server`; hit `/readyz`, capture
   `bootId`.
2. Bounce Postgres (`make db-down && make db-up`, or `make db-reset`).
3. Without restarting `apps/server`, hit `/readyz` again (it issues `SELECT 1`
   against the control-plane pool — see
   [`apps/server/src/routes/health.ts:27`](../../../../../apps/server/src/routes/health.ts)).
4. Record: does the second `/readyz` succeed? After how many attempts? Same
   `bootId`? Repeat for a per-tenant pool path (any tenant-scoped query).

**Branch on the result:**

- **If recovery already works** (per-query reconnect heals it within an
  acceptable number of attempts): the deliverable is (a) make the existing
  behaviour *explicit and intentional* via documented `postgres()` options +
  an inline comment at each site citing this spec, and (b) the regression test
  in §Acceptance that fails if a future change disables it. **Do not add a
  bespoke reconnect/backoff loop** — that would be re-implementing the
  library and is out of scope (see §What's NOT in Scope).
- **If recovery does not work or is unreasonably slow** (e.g. the pool latches
  a permanent error, or recovery needs more than a small bounded number of
  retries): tune the documented `postgres()` resilience options
  (`connect_timeout`, `idle_timeout`, `max_lifetime`, and the
  reconnect/`onclose` behaviour) to the minimum that makes recovery
  deterministic. Bespoke retry logic is a last resort and, if needed, signals
  an Agent-Operability Finding (the library does not do what we assumed) —
  file it rather than silently brute-forcing.

The acceptance test is identical either way; only the size of the code change
differs. The spec deliberately does not pre-commit to a specific option set —
the probe decides it.

## Invariants Touched

- **I20 — Operator Feature/Operations Delivery Without Restart.** Load-bearing.
  A Postgres bounce is an operational event; today it forces an `apps/server`
  restart, which is a standing I20 violation (one of the three always-on §1
  violations enumerated in the parent ticket
  `drift-always-on-2026-05/db-wipe-reseed-forces-restart`). This capability
  *removes* that violation: after Postgres returns, the same process (stable
  `bootId`) self-heals. The always-on bounce test is the witness.
- **I1 — Single ingress** — *unaffected; confirm.* No new HTTP boundary; the
  only `apps/server` edit is at the pool constructor in `bootstrap.ts`, below
  the routing layer. The implementer must confirm no route/middleware change is
  required.
- **I2 — Authorization before execution** — *unaffected; confirm.* The ingress
  pipeline order is untouched. Pool resilience sits beneath the pipeline; a
  reconnect changes *which socket* a query runs on, never *whether* authz ran.
- **I3 — Idempotency before dispatch** — *unaffected; confirm.* The
  idempotency-key store is a per-tenant Postgres row
  ([`always-on.md` §3](../../../../crosscut/always-on.md)); a healed pool reads
  it identically. A reconnect MUST NOT cause a request to skip or double the
  idempotency check — confirm the recovery path does not retry a *whole intent*
  (it retries a connection, not a pipeline pass).
- **I12 — Projections rebuildable from events** — *unaffected; confirm.* The
  event-store append path is kernel (restart-required per
  [`always-on.md` §2](../../../../crosscut/always-on.md)); this capability does
  not touch the append loop, only the pool the loop runs over. Confirm no change
  to append durability.

If, during the probe, recovery turns out to require touching the event-store
append path or the pipeline order, **stop** — that exceeds this capability and
must escalate to `architect` (it would convert a data-plane change into a
kernel change).

## Lexicon

No new canonical nouns/verbs/pipelines. The capability reuses existing terms
(pool, control-plane, per-tenant database, bootId, always-on).

- **Spec-PR TODO (orchestrator-applied, do NOT edit here):** consider adding a
  one-line `LEXICON.md` entry for **"pool resilience"** / **"DB bounce"** if the
  reviewer wants the operational term canonicalised. The author judges this
  optional — the concept is already covered by `always-on.md`'s
  kernel/data framing. Flagging per the ticket's instruction that shared-file
  edits (`LEXICON.md`, `always-on.md`, `INDEX.md`) are applied by the
  orchestrator, not in this slice.

## Surfaces

No new or changed product surfaces. For completeness:

- **Handlers** — none.
- **Events emitted** — none.
- **Projections** — none.
- **Queries** — none.
- **Ports** — none. The `postgres.Sql` pool is an adapter-internal construct;
  no port signature changes.
- **Adapters** — `adapters/node/src/tenant-db-provider.ts` (per-tenant pool
  constructor `openPostgresFromInfo`). Internal config change only.
- **Routes** — none. `/readyz` already exists and is the test witness; it is
  not modified.
- **UI surfaces** — none.
- **Migrations** — none.

The only files that change are the two pool-construction sites plus one new
integration test.

## End-to-End Flow

Not an actor-driven intent flow. The relevant flow is the **operational
recovery path**:

1. `apps/server` is live; control-plane pool and ≥1 per-tenant pool hold open
   connections to Postgres.
2. Operator bounces Postgres (`make db-reset` / `make db-down && make db-up`).
   All held server-side sockets are now dead.
3. The next request (e.g. a `/readyz` probe issuing `SELECT 1`, or any
   tenant-scoped query) hits a stale connection.
4. The pool's resilience behaviour (postgres.js per-query reconnect, made
   explicit by this capability's config) re-establishes a connection to the
   now-healthy Postgres.
5. The request completes successfully against a fresh connection. `bootId` is
   unchanged — no process restart occurred.
6. Subsequent requests run normally on the recovered pool.

## What's Stubbed Today

- **Control-plane pool** — created at
  [`apps/server/src/bootstrap.ts:264`](../../../../../apps/server/src/bootstrap.ts):
  `postgres(config.controlPlaneDbUrl, { max: 5 })`. No resilience options. A
  boot-time `SELECT 1` probe at line 267 fails *loud at boot* but does nothing
  for a mid-life bounce.
- **Per-tenant pools** — created in
  [`adapters/node/src/tenant-db-provider.ts:224`](../../../../../adapters/node/src/tenant-db-provider.ts)
  (`openPostgresFromInfo`) via the `postgres({ host, port, database, user,
  password, max, onnotice })` config-object form. No resilience options. The
  config-object form (not connection-string) is deliberate — preserve it (see
  the auth-failure incident comment at lines 216–223).
- **`/readyz`** — already issues `SELECT 1` against the control-plane pool and
  returns a stable `bootId`
  ([`apps/server/src/routes/health.ts:23`](../../../../../apps/server/src/routes/health.ts)).
  This is the ready-made bounce witness; reuse it, do not add a new endpoint.
- **`make` targets** — `db-up`, `db-down`, `db-reset` already exist in the
  `Makefile`; the integration test drives the bounce through them (or their
  compose equivalents).

## What's NOT in Scope

- **G2 — per-tenant pool invalidation on tenant-DB lifecycle events.** When a
  tenant DB is reprovisioned/migrated *individually* (not a whole-container
  bounce), evicting that tenant's cached pool is a separate gap. Out.
- **G3 — migration-runner resilience.** Re-running migrations against a
  freshly-reseeded DB without restart is the sibling gap
  (`drift-always-on-2026-05/...migration-runner`). Out.
- **Zero-bounce in-place reseed.** Making the wipe/reseed itself not drop
  connections (e.g. `TRUNCATE` instead of `down -v`) is a different approach to
  the same operator pain and is explicitly out — this capability assumes the
  bounce happens and makes the server survive it.
- **Bespoke reconnect/backoff machinery** when postgres.js already recovers
  (see Empirical-First Directive). Re-implementing the driver's pool is an
  anti-goal.
- **Any change to the event-store append path, the ingress pipeline order, or
  any port signature.** Those are kernel; touching them exceeds this slice.

## File-by-File Plan

In execution order. **Step 1 is the empirical probe and gates the size of
steps 2–4.**

1. **(probe, no code)** Run the §Empirical-First Directive bounce experiment;
   record the outcome (recovers? attempts? bootId stable?) in the ticket log.
   The result decides whether steps 2–3 are comment+config only or include
   tuned options.
2. **`apps/server/src/bootstrap.ts`** (control-plane pool, ~line 264) — make the
   resilience behaviour explicit in the `postgres(controlPlaneDbUrl, {...})`
   options object, with an inline comment citing this capability + I20 +
   `always-on.md §1`. Minimum config that makes recovery deterministic per the
   probe; no bespoke retry loop unless the probe proves the driver insufficient
   (and then file an Agent-Operability Finding first).
3. **`adapters/node/src/tenant-db-provider.ts`** (`openPostgresFromInfo`,
   ~lines 224–242) — mirror the same explicit resilience options in the
   per-tenant pool's config-object form. **Preserve** the `host/port/database/
   user/password` config-object shape (the deliberate non-connection-string
   form per the auth-failure incident) and the existing `onnotice` swallow.
4. **`tests/integration/runtime/pool-resilience.itest.ts`** *(new)* — the
   bounce regression test (see §Acceptance for shape). Tagged `@spec:
   specs/domains/runtime/capabilities/pool-resilience/README.md`.

If the probe shows recovery already works, steps 2–3 are dominated by the
explanatory comment and a deliberate (possibly already-default) option set —
the value is the *intentionality* and the regression test, exactly as the
ticket anticipates.

## Things That DON'T Change

- The **control-plane pool's `max: 5`** sizing — unless the probe shows pool
  size is implicated in recovery (unlikely), leave it.
- The **per-tenant config-object form** in `openPostgresFromInfo` — must stay
  the `{ host, port, database, user, password }` shape, never a connection
  string (auth-failure incident, `tenant-db-provider.ts:216–223`).
- The **`onnotice` swallow** in `openPostgresFromInfo`.
- The **boot-time `SELECT 1` fail-loud probe** at `bootstrap.ts:267`.
- **`/readyz`'s** response shape and `bootId`/`startedAt` semantics
  (`health.ts:46–51`) — the test reads them; it does not change them.
- The **ingress pipeline, dispatcher chain, event-store append path, and every
  port signature** — untouched by construction.

## Acceptance

Concrete, named, mechanically-checkable:

- **Integration test (bounce + recover, the load-bearing one)** —
  `tests/integration/runtime/pool-resilience.itest.ts` ▸ *"control-plane pool
  survives a Postgres container bounce without a server restart"* — boot
  `apps/server` against a real Postgres; `GET /readyz` and capture `bootId`;
  bounce Postgres (`make db-down && make db-up` or compose equivalent); poll
  `GET /readyz` until `status: ok` (within a bounded attempt budget the probe
  sets); assert the recovered response carries the **same `bootId`** (no
  restart) and `checks.control_plane_db === 'ok'`.
- **Integration test (per-tenant pool)** — same file ▸ *"per-tenant pool
  survives a Postgres bounce"* — same bounce, but the post-bounce request is a
  tenant-scoped query that exercises a pool from `openPostgresFromInfo`; assert
  it succeeds against the recovered connection, same `bootId`.
- **Non-vacuity guard** — both tests must actually WITNESS the bounce: after
  `make db-down`/`db-up`, the first post-bounce probe MUST observe a severed
  connection (`status !== 'ok'`) before recovery is asserted, so the test can
  never pass vacuously (e.g. if the bounce never reached the container).
  *Reality note (per the empirical probe — see §"Empirical-first"): postgres.js
  recovers via its **default per-query reconnect**, which removing the documented
  `POSTGRES_RESILIENCE_OPTIONS` does NOT disable. So the guard is non-vacuity
  (the bounce is real and recovery happens), NOT "fails if the options are
  removed" — that is not mechanically achievable, because recovery does not
  depend on those options. The options are intentional/documented config
  (timeouts, lifetimes) + the inline comment citing I20; their **presence** is a
  code-review/comment concern, not something the recovery test can witness.*
- **Handler test** — N/A (no handler).
- **Dispatch test (I12)** — N/A (no projection/dispatcher; the dispatch chain
  is untouched — confirmed in §Things That DON'T Change).
- **Contract test** — N/A (no port signature change). *Note:* if the probe
  unexpectedly forces a change to a port or adapter contract, that is a scope
  breach — escalate, do not add a contract test under this capability.
- **BDD scenario** — N/A. This is an operational/infrastructure resilience
  property with no product surface; the integration bounce test is the correct
  layer. Per the Test Pyramid Reconciliation rule, there is no BDD surface that
  could witness "a DB container restarted and the server stayed up" — the
  integration test *is* the canonical witness. Flagging explicitly per the
  template's "don't omit silently" rule.
- **Parity test** — N/A. This is Postgres-pool-specific (`@atlas/adapter-node`);
  the IDB adapter has no connection pool to bounce.

**Spec-PR TODO (orchestrator-applied):** `specs/crosscut/always-on.md` §1 (or
its companion "always-on §1 violations" ledger referenced by the parent
ticket) should record this gap as *closed* once the slice lands. Do NOT edit
`always-on.md` in this slice — note it here for the orchestrator.

## Cross-References

- Domain capability (placement convention): `specs/domains/runtime/capabilities/control-plane-schema-registry/README.md`
- Always-on contract: `specs/crosscut/always-on.md` (§1 kernel/data split, §2 kernel surfaces, §3 data plane)
- Architecture / invariants: `specs/architecture.md` (I20; I1/I2/I3/I12)
- ADR: `specs/decisions/0008-atlas-on-atlas.md` (recursive kernel — code change is the exception)
- Parent ticket: `tickets/drift-always-on-2026-05/db-wipe-reseed-forces-restart.md`
- This slice's ticket: `tickets/drift-always-on-2026-05/pool-reconnect-config.md`
- Sibling gaps (out of scope): G2 per-tenant pool invalidation, G3 migration-runner resilience (same drift set)
- Existing code:
  - `apps/server/src/bootstrap.ts:264` (control-plane pool)
  - `adapters/node/src/tenant-db-provider.ts:224` (`openPostgresFromInfo`, per-tenant pool)
  - `apps/server/src/routes/health.ts:23` (`/readyz` — bounce witness)
  - `Makefile` (`db-up`, `db-down`, `db-reset`)
- Testing contract: `specs/crosscut/testing.md`
