# `apps/server` — `@atlas/server`

The single HTTP ingress (Invariant I1). Hono on `@hono/node-server`. Mirrors
behavior of the legacy Rust `crates/ingress` and is the production target
going forward.

## Layout

```
src/
  main.ts              boots Hono, registers routes, wires middleware, signal handlers
  bootstrap.ts         long-lived state (Postgres pools, JWKS, migrations, adapters)
  config.ts            loadConfig() — env parsing → typed AppConfig
  middleware/
    principal.ts       JWT (OIDC) + X-Debug-Principal → Principal
    correlation.ts     correlationId in/out (Invariant I5)
    errors.ts          error → HTTP response with taxonomy code
    state.ts           composes module handler registries + dispatchers per request
  routes/
    health.ts          liveness/readiness; public
    intents.ts         POST intents → handlers (authz, catalog, content-pages)
    catalog.ts         catalog read endpoints (taxonomies, families, variants, search)
    authz.ts           policy listing
    content-pages.ts   page list, get, render-tree
    events.ts          event queries / SSE broadcast
    debug.ts           dev-only helpers; gated by TEST_AUTH_ENABLED
  events/
    broadcast.ts       SSE / push channel
    dispatcher.ts      composes module dispatchers
```

## Request Lifecycle (summary)

Full trace lives at [`specs/lifecycle.md`](../../specs/lifecycle.md) — read
that first if you're touching the request path. Quick map of what happens
inside this app:

- **Intent** (POST `/api/v1/intents`): `routes/intents.ts:27` → `submitIntent` → ingress pipeline (authn / tenant / schema / idempotency / authz / handler dispatch) → handler emits events → `dispatch` runs the `composeDispatchers` chain → 202 response.
- **Query** (GET `/...`): `routes/<name>.ts` → tenant-scoped bundle → `evaluateRead` (when applicable) → module query function → `ProjectionStore.get(tenant-scoped key)` → JSON.

The dispatcher chain is assembled per-request in
`src/middleware/state.ts:118-134`:

```
catalogDispatcher
  → contentPagesDispatcher
  → cacheTagDispatcher(cache)         ← invalidates by event.cacheInvalidationTags
  → policyCacheDispatcher (cedar)     ← conditional
  → serverEventDispatcher(broadcast)  ← SSE fanout, runs last
```

The chain runs in one of two places depending on `WORKER_MODE`:

- `WORKER_MODE=inline` (default) — `apps/server/src/middleware/state.ts:161` builds the chain and `state.dispatch` runs it synchronously in-request before 202 returns
- `WORKER_MODE=async` — `state.dispatch` is a no-op; the projection-worker (`apps/projection-worker/`) drains the event store and runs the same chain composition out-of-band

Both modes use the **same composition** — when adding a dispatcher,
edit it once in `state.ts` and once in `apps/projection-worker/src/tenant-loop.ts`
(or factor the composition into a shared package later). The chains are
deliberately mirrored so the cut-over is a flag flip, not a rewrite.

Full design + migration phases: [`specs/worker.md`](../../specs/worker.md).

## Boot Sequence

1. `main.ts` calls `loadConfig()` → typed `AppConfig`
2. `bootstrap.ts` runs: Postgres pools, migration runner, JWKS remote, adapter instantiation (node + policy-cedar/stub), `AppState` assembled
3. `main.ts` builds the Hono app:
   - Public group: `/health`, `/metrics` (no auth)
   - Authed group: `app.use('*', principalMiddleware(state))` then route registrations
4. SIGINT / SIGTERM → graceful shutdown, drain pools

## Routes

File-per-route group. Each `routes/<name>.ts` exports a function:

```ts
export function catalogRoutes(state: AppState): Hono { … }
```

Wired in `main.ts` via `app.route('/', catalogRoutes(state))`.

There is no file-path routing convention — Hono handlers are explicit. Add a
new route group by:
1. Creating `src/routes/<name>.ts` exporting a `Hono`-returning factory.
2. Registering it in `main.ts`.

## Authentication

`middleware/principal.ts` accepts:

- **JWT** via `Authorization: Bearer …`, validated against the OIDC JWKS endpoint configured by `OIDC_ISSUER_URL` / `OIDC_JWKS_URL` (using `jose`).
- **`X-Debug-Principal`** header — only when `TEST_AUTH_ENABLED=true`. Production deployments must not set this.

The resolved `Principal` (with `tenantId`) is attached to Hono `Variables` so
downstream handlers can read it without re-parsing.

## Per-request Module Wiring

`middleware/state.ts` composes the handler registries and dispatchers for the
three modules (authz, catalog, content-pages) into a single per-request
context. Tenant-scoped adapter instances come from
`@atlas/adapter-node`'s `TenantDbProvider` (LRU pool, resolves a `tenantId` to a
Postgres pool).

## Configuration (env vars)

| Var | Purpose |
|-----|---------|
| `CONTROL_PLANE_DB_URL` | Postgres for the control plane |
| `OIDC_ISSUER_URL` / `OIDC_JWKS_URL` | OIDC JWT validation |
| `TEST_AUTH_ENABLED` | When `true`, allow `X-Debug-Principal`. **Never in prod.** |
| `TENANT_ID` | Forbidden in `strict` mode; dev-only convenience |
| `INGRESS_PORT` | HTTP port (default 3000) |
| `POLICY_ENGINE` | `cedar` or `stub` (selects which `PolicyEngine` adapter is wired) |

`config.ts` is the source of truth — `loadConfig()` is the only sanctioned
reader.

## Invariants Enforced Here

- **I1** Single ingress — no other app exposes HTTP
- **I2** Authorization runs **before** handler dispatch (in `intents.ts` flow)
- **I3** Idempotency check before dispatch
- **I5** `correlationId` middleware on every request
- **I9** Cache keys built tenant-scoped via `@atlas/platform-core` helpers

## Conventions

- **No domain logic in `routes/*`.** Routes parse + validate + delegate to module handlers / queries. Anything domain-shaped goes in `/modules`.
- **No SQL in `routes/*`.** Storage is reached through ports → adapters.
- **Errors via `errors.ts`.** Module errors carry a `code` string; `errors.ts` middleware maps that to HTTP status + JSON body.
- **`bootstrap.ts` is the only place that imports adapter packages.** Routes get adapters through the request state.

## Running

```
pnpm --filter @atlas/server dev
```

Make sure Postgres is up: `make db-up`. To use the debug-principal flow, set
`TEST_AUTH_ENABLED=true` and pass `X-Debug-Principal: <principal-json>`.

## When Looking for Behavior That's Still in Rust

If you're tracing a route or behavior that exists in `crates/ingress/` but not
yet in `apps/server`, that's expected — porting is in progress (see
`PROGRESS.md`). Add the port here; do not extend the Rust side.
