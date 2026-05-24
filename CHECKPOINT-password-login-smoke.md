# Checkpoint — real password-login smoke test (BLOCKED on identity schemas)

**Date captured:** 2026-05-23
**Why this file exists:** snapshot of the exact state where we set up the real
email+password login smoke test and got everything working *except* the final
login, which is blocked. We implement `atlas-on-atlas/control-plane-schema-registry`,
then return to this checkpoint and re-run the login attempt to confirm it works.

---

## The goal

Create a tenant, visit `<tenant>.localhost:3000` in a browser, and log in with a
real email + password (Argon2 verify + real session cookie) via the admin SPA's
login surface (`apps/admin/src/features/identity/login-surface.ts` →
`passwordLogin` → `POST /api/v1/intents` with `Identity.Login.Password`).

## What is VERIFIED WORKING (the rest of the stack is healthy)

- **Podman infra:** control-plane Postgres `:15433` + smtp4dev `:1025`/`:5080`.
- **`pnpm dev:up`** provisions `_platform` + `dev-tenant` (DB `atlas_t_dev_tenant`).
- **Server boots healthy** with: `TEST_AUTH_ENABLED=true INSECURE_COOKIES=true
  COOKIE_DOMAIN=.localhost MAILER_MODE=smtp SMTP_HOST=localhost SMTP_PORT=1025
  SMTP_FROM=atlas@localhost POLICY_ENGINE=stub WORKER_MODE=inline INGRESS_PORT=3000`
  + `CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/control_plane`.
  Start: `pnpm --filter @atlas/server dev`.
- **Admin SPA** builds + is server-served at `:3000`:
  `VITE_BACKEND=http VITE_TENANT_ID=dev-tenant VITE_API_URL=http://localhost:3000 pnpm --filter @atlas/admin build` → `dist/admin/`.
- **Intent pipeline is healthy for registered domains** — proven:
  `ContentPages.Page.Create` → `202`, projection read-back `200`.
- **Magic-link login WORKS end-to-end** (dedicated routes that bypass the
  schema-validated intent pipeline): signup → admin approve (provisions tenant +
  `custom_domains` row + emails magic link) → confirm sets an `atlas_session`
  cookie scoped to `.localhost` → tenant-home at `<slug>.localhost:3000` renders
  "Signed in as <email>". Verified for tenant `smoketenant`.

## What FAILS (the blocker)

Every `Identity.*` intent through `POST /api/v1/intents` returns **`400 UNKNOWN_SCHEMA`**:

```
Identity.User.Create      → schema not found: identity.user.create.v1
Identity.User.SetPassword → schema not found: identity.user.set_password.v1
Identity.Login.Password   → schema not found: identity.login.password.v1
Identity.Membership.Create→ schema not found: identity.membership.create.v1
```

So the browser login form (and seeding a password user via the API) cannot work.

## Root cause (with evidence)

1. **No `identity.*` schemas exist anywhere.** `specs/schemas/contracts/` and
   `packages/schemas/src/generated/` contain authz / catalog / content_pages /
   dsl / repository / seed only — zero identity intent schemas. (`grep -ri identity specs/schemas packages/schemas` → nothing.)
2. **`submitIntent` hard-rejects unregistered schemas** before the handler runs:
   `packages/ingress/src/submit-intent.ts:149-152` (`UNKNOWN_SCHEMA`, 400).
3. **The schema registry is compile-time-static.** `packages/schemas/src/loader.ts`
   builds one **cached** ajv (`cachedAjv`) from a hardcoded array of static
   `import … with { type: 'json' }`. The only runtime mutation is
   `__setSchemaValidatorOverrideForTest` (test-only). So adding a schema = edit
   source + regenerate + recompile `@atlas/schemas` + **restart** (a kernel touch
   under I20).
4. **Action lookup is also manifest-static.** `submitIntent` step 5 calls
   `getAction(actionId)`; `PostgresControlPlaneRegistry` (adapters/node/src/control-plane-registry.ts)
   builds its action map from bundled `moduleManifests()`. **There is no identity
   manifest** — so even if the schema validated, `getAction('Identity.Login.Password')`
   would be `null` → `UNKNOWN_ACTION`.
5. The control-plane pool is **already passed** to `PostgresControlPlaneRegistry`
   (`bootstrap.ts:363`) but unused — the header comment reserves it for exactly
   "live schema lookups, tenant-module enablement" (control-plane-registry.ts:10-12).
6. The `Identity.Login.Password` **handler already exists and is wired**
   (`modules/identity/src/handlers/registry.ts:676`). Only the *declarations*
   (schema + action entry) are missing — making this the textbook "should be data" case.

## The fix being implemented

`tickets/atlas-on-atlas/control-plane-schema-registry.md` — move schema + action
registration to control-plane DATA so adding them is a hot, no-restart write.
After it lands, registering the identity schemas + action entries is a data
operation, and the login flow works through `/intents`.

---

## How to rebuild this checkpoint after the ticket lands

```bash
# infra (likely already up)
make db-up && pnpm smtp:up
# provision control plane + dev tenant
CONTROL_PLANE_DB_URL='postgres://atlas_platform:local_dev_password@localhost:15433/control_plane' pnpm dev:up
# build admin SPA for dev-tenant
VITE_BACKEND=http VITE_TENANT_ID=dev-tenant VITE_API_URL=http://localhost:3000 pnpm --filter @atlas/admin build
# start server (real-auth, not dev-mode)
CONTROL_PLANE_DB_URL='postgres://atlas_platform:local_dev_password@localhost:15433/control_plane' \
  TEST_AUTH_ENABLED=true INSECURE_COOKIES=true COOKIE_DOMAIN=.localhost \
  MAILER_MODE=smtp SMTP_HOST=localhost SMTP_PORT=1025 SMTP_FROM=atlas@localhost \
  POLICY_ENGINE=stub WORKER_MODE=inline INGRESS_PORT=3000 \
  pnpm --filter @atlas/server dev
```

## Success criteria for the retry (after the ticket lands)

1. Register the identity intent schemas + action entries as control-plane data
   (no recompile, no restart — `bootId` stable across the registration).
2. Seed a password user in `dev-tenant`: `Identity.User.Create` →
   `Identity.User.SetPassword` (now 202, not 400 UNKNOWN_SCHEMA).
3. `Identity.Login.Password` with the correct password → 202, real session
   cookie issued; wrong password → `LoginRejected`.
4. In the browser at `http://localhost:3000/#/login` (or `<tenant>.localhost:3000`),
   type email + password → login surface reaches `success`, lands authenticated.
5. The whole thing "makes sense": the same intent pipeline + invariants
   (I2 authz, I3 idempotency, I5 correlationId) run for identity exactly as for
   content-pages — no special-casing.
