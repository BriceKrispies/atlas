# Incident: tenant-db-provider auth fails with same credentials as control-plane

**Date:** 2026-05-08
**Severity:** P2 — blocks any intent submission against the TS apps/server in dev (any flow that needs a tenant-scoped DB pool). No production impact (no production deploy yet).
**Status:** **Resolved** by `fix(adapter-node): use postgres.js config object for tenant pools` (this incident report's companion commit). Verified end-to-end: `pnpm atlasctl intents submit` against a freshly-booted TS server now returns 202 and the row lands in `public.events` with the correct `tenant_id`, `principal_id`, and `correlation_id`. Idempotency (re-submit with same key) returns the same `eventId` per INV-I3.

## Summary

`apps/server` boots successfully, runs control-plane migrations against the control-plane DB, and serves health endpoints. But the *first* tenant-scoped database operation fails with `PostgresError: password authentication failed for user "atlas_platform"` — using the **same credentials** that just worked for the control-plane connection. Specifically, the failure is in `PostgresTenantDbProvider.openPool` when it tries to acquire a per-tenant pool.

This blocks every intent submission via `POST /api/v1/intents` (the canonical pipeline depends on `ensureTenantMigrated` → `tenantDb.getPool(tenantId)`). It is reproducible against a freshly-booted server with the dev-default `CONTROL_PLANE_DB_URL`.

## Impact

- atlasctl `intents submit` (and any other consumer of `/api/v1/intents`) returns 500 with `TRANSACTION_FAILED / Internal storage failure`.
- All identity, content-pages, catalog, and authz handler flows are blocked at the tenant-pool acquisition step.
- Health and read paths that don't need tenant DB access (`/`, `/healthz`, `/readyz`, `/metrics`) are unaffected.
- Tests using in-memory adapters are unaffected.

## Timeline

- **2026-05-08 ~18:00** — While hand-verifying atlasctl Phase A end-to-end, observed `intents submit` returning 500 against the TS server.
- **18:01** — Server log showed `tenant dev-tenant: not found in control_plane.tenants`. Inserted a tenant row with explicit `db_*` columns pointing at the same Postgres instance (`localhost:5432/tenant_dev`). New error: `password authentication failed`.
- **18:05** — Suspected the in-container port `5432` vs host-mapped `15433` mismatch. Updated `db_port=15433`. Same error.
- **18:08** — Verified credentials work in isolation: `podman exec atlas-platform-control-plane-db psql "postgres://atlas_platform:local_dev_password@localhost:5432/tenant_dev"` succeeds and returns `current_user=atlas_platform, current_database=tenant_dev`.
- **18:12** — NULL'd the per-tenant `db_*` columns to fall back to `defaultConnectionInfo` (which `apps/server/src/bootstrap.ts:155` sets to `parseTenantConnectionUrl(controlPlaneDbUrl)` — the **same URL** that just worked for `controlPlaneSql`). Same error. This is the smoking gun: identical credentials, identical Postgres instance, only difference is the code path.

## Root Cause (hypothesis)

The control-plane connection at `apps/server/src/bootstrap.ts:142` calls:

```ts
const controlPlaneSql = postgres(config.controlPlaneDbUrl, { max: 5 });
```

→ Passes the **raw URL string** to postgres.js.

The tenant-pool path at `adapters/node/src/tenant-db-provider.ts:192` calls:

```ts
const pool = postgres(connectionString(info), { max: this.poolMax });
```

→ Passes a **rebuilt URL** to postgres.js, where `info` came from `parseTenantConnectionUrl(originalUrl)`.

The round-trip `parseTenantConnectionUrl` → `connectionString` looks idempotent on the surface. For the dev-default URL `postgres://atlas_platform:local_dev_password@localhost:15433/control_plane`, `info.user` and `info.password` are read via `decodeURIComponent` (no-op for these strings), and `connectionString` rebuilds without any re-encoding:

```ts
function connectionString(info: TenantConnectionInfo): string {
  return `postgres://${info.user}:${info.password}@${info.host}:${info.port}/${info.name}`;
}
```

Character-for-character the rebuilt string equals the input. Yet postgres.js authenticates successfully on one and fails on the other. The current best hypothesis is that postgres.js parses URLs differently from `new URL()` for some component (likely the password — postgres.js has its own URL parser in `src/options.js`), and the round-trip loses or mangles a percent-encoded sequence that `new URL()` accepted.

Possible alternative causes (not yet ruled out):
- Pool isolation issue in postgres.js `^3.4.9` where two separate `postgres()` instances against the same DB negotiate auth differently (SCRAM nonce, prepared-statement scope).
- IPv6 vs IPv4 resolution: `localhost` resolves to `::1` for one connection and `127.0.0.1` for another, hitting different `pg_hba.conf` rules. (Container's `pg_hba.conf` does have `host all all 127.0.0.1/32 trust`, `host all all ::1/128 trust`, and `host all all all md5` as a catch-all; if connections go via the host bridge interface they'd hit the catch-all.)

## Reproduction

Minimal repro on a clean dev environment:

```sh
# 1. Database up
make db-up

# 2. Start the TS server with test-auth
CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/control_plane \
TEST_AUTH_ENABLED=true \
POLICY_ENGINE=stub \
WORKER_MODE=inline \
TENANT_ID=dev-tenant \
pnpm --filter @atlas/server start

# 3. Insert a tenant row with NULL db_* (use defaultConnectionInfo fallback)
podman exec atlas-platform-control-plane-db psql -U atlas_platform -d control_plane -c \
  "INSERT INTO control_plane.tenants (tenant_id, name) VALUES ('dev-tenant', 'Dev Tenant') ON CONFLICT DO NOTHING;"

# 4. Submit any intent
pnpm atlasctl --debug-principal "user:tester:dev-tenant" \
  intents submit some-intent.json --json
```

Expected: 202 (or a domain-level error from the handler).
Actual: 500 with `PostgresError: password authentication failed for user "atlas_platform"` in the server log, surfaced to atlasctl as `{"code":"TRANSACTION_FAILED","message":"Internal storage failure"}`.

## Workaround

None known yet. Operations that don't need a tenant DB pool work fine.

## Resolution

`adapters/node/src/tenant-db-provider.ts` no longer round-trips through a URL string for tenant pools. The internal `connectionString()` helper has been deleted and replaced by `openPostgresFromInfo(info, max)`, which calls postgres.js with its config-object form:

```ts
postgres({
  host: info.host,
  port: info.port,
  database: info.name,
  user: info.user,
  password: info.password,
  max,
})
```

This sidesteps any URL-parser ambiguity between postgres.js's own parser, `new URL()`, and the hand-rolled `connectionString()`. We already had all five fields as plain strings/numbers in `TenantConnectionInfo` — feeding them directly to postgres.js eliminates an entire layer of failure modes.

`parseTenantConnectionUrl` is unchanged — the URL → struct path is still the right shape for `defaultConnectionInfo` and direct row-column reads. Only the struct → URL → postgres.js round-trip on the way out was broken; the fix removes that round-trip.

### Verification

End-to-end smoke against a freshly-booted TS server, podman Postgres, `TEST_AUTH_ENABLED=true`, `POLICY_ENGINE=stub`, fallback `defaultConnectionInfo` (NULL `db_*` cols):

```sh
$ pnpm atlasctl --debug-principal "user:smoke-tester:dev-tenant" \
    intents submit /tmp/real-intent.json --json
{"correlationId":"d6083cdf-...","status":"ok","httpStatus":202,
 "data":{"eventId":"evt-mow6aoeg-p75vnifj",
         "tenantId":"dev-tenant","principalId":"smoke-tester"}}

$ # row landed:
$ podman exec ... psql -d control_plane -c "select event_id, event_type, tenant_id, principal_id, correlation_id from public.events;"
       event_id        |        event_type        | tenant_id  | principal_id |     correlation_id
-----------------------+--------------------------+------------+--------------+-------------------------
 evt-mow6aoeg-p75vnifj | ContentPages.PageCreated | dev-tenant | smoke-tester | corr-atlasctl-smoke-001

$ # re-submit with same idempotencyKey (INV-I3):
$ pnpm atlasctl ... intents submit ...   # returns same eventId; row count stays at 1
```

## Detection / Action Items

1. **Add a smoke test** that boots the TS server, inserts a tenant row with NULL `db_*`, and submits an intent. Asserts 202 + a row in `events`. Catches this regression class. (Currently the contract tests don't cover this seam — they exercise individual adapters with explicit DB URLs.)
2. **Document tenant DB connection setup** for dev — the bootstrap-the-tenant-row step is missing from `apps/server/CLAUDE.md`.
3. **Audit other URL round-trips** in `adapters/node/src/`. If `parseTenantConnectionUrl` was wrong, similar patterns may exist.
4. **Consider deprecating `connectionString()`** entirely in favor of the config-object form. The function is used only in one place; the indirection adds no value.

## Lessons

- "Same credentials should work" reasoning is insufficient when the connection string crosses a parser. A round-trip that LOOKS idempotent isn't necessarily so for downstream consumers with their own parsing rules.
- The contract-tests suite covers each adapter against an explicit DB URL but does **not** exercise the *bootstrap → tenant-pool acquisition* seam against a real Postgres. This integration gap is exactly where this bug landed.
- Detection only happened during hand-verification. An automated smoke that submits one real intent against a freshly-booted server would have caught this immediately. (This is also the kind of thing the proposed `artifacts` agent — `~/.claude/plans/artifacts-agent.md` — exists to catch.)
