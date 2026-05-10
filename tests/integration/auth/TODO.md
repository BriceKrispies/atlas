# TODO — Run the auth integration test suite end-to-end

The 7 e2e tests under this directory exercise the full HTTP surface
of `apps/server` for every auth flow Identity ships. They were
written but **not yet verified against a live stack** — partial run
on 2026-05-09 turned up real bugs in the test code that have been
fixed, but a complete green run is still pending.

## Pre-flight: services that need to be up

| Service | Port | How to start | Why |
|---------|------|--------------|-----|
| Postgres (control plane) | `localhost:15433` | `pnpm smtp:up`-equivalent for dev stack — typically `make db-up` or your existing dev compose | tenancy + per-tenant DB pools |
| `apps/server` | `localhost:3000` | `pnpm --filter @atlas/server dev` (env below) | the system under test |
| smtp4dev | `localhost:5080` | `pnpm smtp:up` | catches outbound mail for invite-accept + magic-link tests |
| Keycloak | `localhost:8081` | `podman run` command below | OAuth client_credentials + (future) SAML |

### Required `apps/server` env

```sh
CONTROL_PLANE_DB_URL='postgres://atlas_platform:local_dev_password@localhost:15433/control_plane' \
TEST_AUTH_ENABLED=true \
DEBUG_AUTH_ENDPOINT_ENABLED=true \
TENANT_ID=dev-tenant \
MAILER_MODE=smtp \
SMTP_HOST=localhost SMTP_PORT=1025 SMTP_FROM='itest@atlas.local' \
COOKIE_DOMAIN=.localhost \
OIDC_ISSUER_URL='http://localhost:8081/realms/atlas' \
OIDC_JWKS_URL='http://localhost:8081/realms/atlas/protocol/openid-connect/certs' \
OIDC_AUDIENCE='account' \
INGRESS_PORT=3000 \
POLICY_ENGINE=stub \
WORKER_MODE=inline \
pnpm --filter @atlas/server dev
```

`TENANT_ID=dev-tenant` matters: the only tenant provisioned in the
local control-plane DB is `dev-tenant`. Setting it to anything else
(e.g. `tenant-itest-001`) makes every intent fail with
`TRANSACTION_FAILED` because the tenant DB pool can't be opened.
The tests already read from `process.env['TENANT_ID']` with a
`dev-tenant` default, so the test side is fine — this is the
server-side override that has to match.

### Keycloak — start with the atlas realm imported

The realm export at `infra/compose/config/keycloak/atlas-realm.json`
needs to be mounted into Keycloak's `data/import/` directory and the
container started with `start-dev --import-realm`.

**PowerShell (Windows-friendly path handling):**

```powershell
podman run -d --name atlas-itest-kc `
  -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin `
  -e KC_HOSTNAME=localhost -e KC_HOSTNAME_PORT=8081 `
  -e KC_HOSTNAME_STRICT=false -e KC_HOSTNAME_STRICT_HTTPS=false `
  -e KC_HTTP_ENABLED=true -e KC_HEALTH_ENABLED=true `
  -p 8081:8080 `
  -v "C:\dev\atlas\infra\compose\config\keycloak\atlas-realm.json:/opt/keycloak/data/import/atlas-realm.json:ro" `
  quay.io/keycloak/keycloak:25.0 `
  start-dev --import-realm
```

(Don't try to do this from Git Bash — the colon between the host
path and `:ro` gets mangled by MSYS path-translation. Use PowerShell
or invoke through the compose file with the env vars
`compose.itest-infra.yml` expects.)

Wait for the realm to come up:

```sh
until curl -sf http://localhost:8081/realms/atlas/.well-known/openid-configuration -o /dev/null; do sleep 3; done
```

## Run

```sh
INGRESS_BASE_URL=http://localhost:3000 \
SMTP4DEV_URL=http://localhost:5080 \
KEYCLOAK_BASE_URL=http://localhost:8081 \
CONTROL_PLANE_DB_URL='postgres://atlas_platform:local_dev_password@localhost:15433/control_plane' \
pnpm test:integration tests/integration/auth/
```

The Playwright runner is configured serial (workers: 1) — don't run
in parallel against a single Postgres / single apps/server.

## What's known to need attention before a full green run

These are known issues from the partial run on 2026-05-09. Some are
real bugs in the test code that have been patched; others are
genuine gaps in the test coverage.

1. **`oauth-client-credentials.itest.ts` — Atlas-issued tokens path.**
   Failed first run with `TRANSACTION_FAILED` on `Identity.ServicePrincipal.Create`.
   Caused by `TENANT_ID=tenant-itest-001` mismatch (already patched in
   test code; verify `TENANT_ID=dev-tenant` is on the server too).

2. **`password-login.itest.ts` — wrong-password reject test.**
   Used `anon:public:` principal; valid X-Debug-Principal types are
   `user` / `service` / `anonymous`. Patched to `anonymous:public:<tenant>`.
   Second run pending.

3. **`saml-sso.itest.ts` — realm-probe was too lax.**
   Keycloak returns metadata for any client ID at
   `/protocol/saml/clients/<id>`, so the probe always passed and the
   test ran past pre-flight into a failure. Now skips unless
   `KEYCLOAK_SAML_SP_PRESENT=1` is explicitly set. To enable: refresh
   the realm export per `infra/compose/keycloak/README.md` to include
   a SAML SP at `atlas-platform-sp`, then set the env var.

4. **`mfa-step-up.itest.ts` — depends on `/debug/totp/code` helper.**
   The test computes a valid TOTP code by calling
   `${INGRESS}/debug/totp/code?secret=<base32>`. If that endpoint
   isn't exposed (only enabled when both `TEST_AUTH_ENABLED=true`
   AND `DEBUG_AUTH_ENDPOINT_ENABLED=true`), the test skips with
   `'/debug/totp/code helper not available'`. Either add the
   endpoint or compute the code in-test using
   `@atlas/identity`'s `hotp(secret, counter)` directly (the unit
   test in `modules/identity/test/unit/totp.test.ts` does this).

5. **`invite-accept.itest.ts` — has not been run yet.**
   Needs both apps/server + smtp4dev. Polls smtp4dev for the
   delivered email, extracts the magic-link, follows it, asserts a
   session cookie. Mirrors `tests/integration/public-signup.itest.ts`
   shape but for the admin-invite flow (existing tenant + admin
   issues invite, vs. public signup minting a new tenant).

6. **`api-key.itest.ts` — has not been run yet.**
   apps/server only. Most likely candidate to pass on first attempt.

## Stop everything

```sh
podman stop -t 3 atlas-itest-kc atlas-dev-smtp4dev atlas-platform-control-plane-db
podman rm -f atlas-itest-kc atlas-dev-smtp4dev atlas-platform-control-plane-db
```

Plus kill the `apps/server` shell. Be aware that `tsx`'s hot-reload
spawns one node child per restart — a long-running dev session can
leave dozens of zombie node processes around. Restart the shell or
reboot if memory pressure shows up.

## Once everything passes

- Move this file's content into a stable runbook (or delete the
  TODO and replace with a brief "see CONTRIBUTING.md" pointer).
- Wire the auth-suite path into CI: it's on the `tests/integration`
  Playwright config; the gate is whether Keycloak + smtp4dev can be
  brought up in CI.
- Refresh the realm export to add the SAML SP so `saml-sso.itest.ts`
  becomes a real test instead of a `describe.skip`.
