# @atlas/server

Node HTTP server (Hono + postgres.js) that wires the TypeScript ingress
pipeline to the Postgres adapters. It exposes the same routes as the Rust
ingress (`POST /api/v1/intents`, `GET /api/v1/catalog/...`, `/healthz`,
`/readyz`) so `atlas itest` can target it without changing the supervisor.

## Status

Chunk 4 of the TS rewrite. **Not yet** the source of truth — Rust ingress
stays canonical until the Chunk 5 parity gate goes green for two weeks.

## Env vars

Same names the Rust ingress + `tools/cli/src/itest_supervisor.rs` use:

| Variable                       | Required          | Default       | Purpose                                |
|--------------------------------|-------------------|---------------|----------------------------------------|
| `CONTROL_PLANE_DB_URL`         | yes               | —             | Control-plane Postgres URL             |
| `OIDC_ISSUER_URL`              | yes (prod)        | —             | OIDC issuer (Keycloak realm)           |
| `OIDC_JWKS_URL`                | yes (prod)        | —             | JWKS endpoint for token verification   |
| `OIDC_AUDIENCE`                | no                | `account`     | Required `aud` claim                   |
| `TEST_AUTH_ENABLED`            | no                | `false`       | Accept `X-Debug-Principal` header      |
| `DEBUG_AUTH_ENDPOINT_ENABLED`  | no                | `false`       | Register `/debug/whoami` (test-auth)   |
| `TENANT_ID`                    | no                | `dev-tenant`  | Default tenant when JWT omits one      |
| `INGRESS_PORT` / `PORT`        | no                | `3000`        | HTTP listen port                       |
| `RUST_LOG`                     | no                | `info`        | Logged on boot for parity              |

When `TEST_AUTH_ENABLED=true`, OIDC values are not required — the server
won't try to verify tokens.

## Run

```bash
pnpm --filter @atlas/server dev      # tsx watch
pnpm --filter @atlas/server start    # tsx, no watch
```

```bash
curl localhost:3000/healthz                                    # liveness
curl localhost:3000/readyz                                     # readiness (DB ping)
curl -H "X-Debug-Principal: user:demo" localhost:3000/debug/whoami
curl -X POST -H "X-Debug-Principal: user:demo" \
     -H "Content-Type: application/json" \
     --data '{"...intent envelope..."}' \
     localhost:3000/api/v1/intents
```

## Lifecycle

- `SIGINT` / `SIGTERM` → close listener, drain DB pools, exit 0.
- Bootstrap failure (no control-plane DB, bad JWKS URL) → log + exit 1.
- Tenant DB migrations: applied on first per-tenant access, cached in
  process memory thereafter. Re-runs at process restart are no-ops.

## `atlas itest` integration (Chunk 5)

The `itest_supervisor` already exports the env vars listed above; pointing
it at `@atlas/server` instead of `crates/ingress` is a Chunk 5 task once the
parity tests can drive both targets.
