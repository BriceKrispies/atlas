# `apps/server` — `@atlas/server`

The single HTTP ingress (Invariant I1). Hono on `@hono/node-server`. This is
the production HTTP boundary for Atlas.

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
    cookie.ts          cookie parsing/signing helpers
    csrf.ts            CSRF token issue + verify (cookie-bound flows)
    jwks-cache.ts      OIDC JWKS fetch + cache
    role-check.ts      role guard helper for routes
    scim-auth.ts       SCIM bearer-token auth (separate from JWT principal)
    tenant-resolution.ts  resolves tenantId for public/cookie flows
  routes/
    health.ts          liveness/readiness; public
    metrics.ts         Prometheus scrape endpoint; public
    intents.ts         POST intents → handlers (authz, catalog, content-pages, identity)
    catalog.ts         catalog read endpoints (taxonomies, families, variants, search)
    authz.ts           policy listing
    content-pages.ts   page list, get, render-tree
    events.ts          event queries / SSE broadcast
    identity.ts        public identity routes (e.g. invite-accept; token IS auth)
    identity-a7.ts     identity A7 phase routes (impersonation / break-glass / risk)
    identity-idp.ts    IdP-side identity wiring
    mfa.ts             multi-factor enrolment + challenge
    oauth.ts           OAuth 2.0 endpoints (public; auth via client credentials)
    saml.ts            SAML 2.0 endpoints (public; ACS verifies IdP signature)
    scim.ts            SCIM 2.0 endpoints (public mount; bearer self-validates)
    debug.ts           dev-only helpers; gated by TEST_AUTH_ENABLED + DEBUG_AUTH_ENDPOINT_ENABLED
  events/
    broadcast.ts       SSE / push channel
    dispatcher.ts      `serverEventDispatcher` — fans events to SSE subscribers
```

## Request Lifecycle (summary)

Full trace lives at [`specs/lifecycle.md`](../../specs/lifecycle.md) — read
that first if you're touching the request path. Quick map of what happens
inside this app:

- **Intent** (POST `/api/v1/intents`): `routes/intents.ts:27` → `submitIntent` → ingress pipeline (authn / tenant / schema / idempotency / authz / handler dispatch) → handler emits events → `dispatch` runs the `composeDispatchers` chain → 202 response.
- **Query** (GET `/...`): `routes/<name>.ts` → tenant-scoped bundle → `evaluateRead` (when applicable) → module query function → `ProjectionStore.get(tenant-scoped key)` → JSON.

The dispatcher chain is assembled per-request in
`src/middleware/state.ts` (search for `composeDispatchers`):

```
catalogDispatcher
  → contentPagesDispatcher
  → identityDispatcher
  → cacheTagDispatcher(cache)         ← invalidates by event.cacheInvalidationTags
  → policyCacheDispatcher (cedar)     ← conditional (only when engine is cedar)
  → serverEventDispatcher(broadcast)  ← SSE fanout, runs last
```

The chain runs in one of two places depending on `WORKER_MODE`:

- `WORKER_MODE=inline` (default) — `state.ts` builds the chain and `state.dispatch` runs it synchronously in-request before 202 returns
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
   - Public group (no `principalMiddleware`): `health`, `metrics`, `identity` (invite-accept — token IS the auth), `oauth` (client_id/secret on body), `scim` (SCIM bearer self-validates), `saml` (ACS verifies IdP signature)
   - Authed group: `app.use('*', principalMiddleware(state))` then `intents`, `catalog`, `authz`, `content-pages`, `events`, `identity-authed`, `identity-idp`, `identity-a7`, `mfa` (and `debug` when `testAuth.enabled` + `debugEndpoints`)
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
four modules (authz, catalog, content-pages, identity) into a single per-request
context. The principal is also enriched here (roles + ABAC attributes from
`User`/`Membership` lookups against the per-tenant entity store) before being
threaded into `IngressState`. Tenant-scoped adapter instances come from
`@atlas/adapter-node`'s `TenantDbProvider` (LRU pool, resolves a `tenantId` to a
Postgres pool).

## Configuration (env vars)

| Var | Purpose |
|-----|---------|
| `CONTROL_PLANE_DB_URL` | Postgres for the control plane (required) |
| `OIDC_ISSUER_URL` / `OIDC_JWKS_URL` / `OIDC_AUDIENCE` | OIDC JWT validation; the full triplet is required in strict mode (test-auth OFF). In test-auth mode `OIDC_AUDIENCE` defaults to `account`. |
| `TEST_AUTH_ENABLED` | When `true`, allow `X-Debug-Principal`. **Never in prod.** |
| `DEBUG_AUTH_ENDPOINT_ENABLED` | Gates `/debug/*` routes (in addition to `TEST_AUTH_ENABLED`). |
| `TENANT_ID` | Forbidden in strict mode; dev-only fallback (`dev-tenant`). |
| `INGRESS_PORT` (or `PORT`) | HTTP port (default 3000) |
| `POLICY_ENGINE` | `cedar` or `stub` — default `stub` |
| `WORKER_MODE` | `inline` (default) or `async` — see dispatcher chain section + [`specs/worker.md`](../../specs/worker.md) |
| `RUST_LOG` | Logged on boot for parity with the legacy ingress (no-op otherwise) |

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
