# 0015 — Dev-mode contract and safety guards

**Status:** Accepted (2026-05-20)
**Depends on:** [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) (I13 single ingress, I17 API/CLI/UI parity), [`0008-atlas-on-atlas.md`](0008-atlas-on-atlas.md) (`_platform` is a real tenant; seeding pattern), [`0014-self-evolving-substrate.md`](0014-self-evolving-substrate.md) (the seed-bundle pattern dev tenants eventually use).
**Touches invariants:** I1 (single ingress — dev mode does not add side doors), I2 (authz still runs — dev does not bypass policy evaluation), I5 (correlationId still propagates), I13 / REQ-INGRESS-002 (unauthenticated dev requests are upgraded to a real principal, not allowed through anonymously).

## Context

Atlas wants two things that pull against each other for local development:

1. **Frictionless dev UX** — a dev runs a few commands, gets a control plane + DB + a seeded dev tenant + a working power-admin principal, and starts shipping changes. No JWT issuance, no token juggling, no header headaches.
2. **Prod parity** — deploying to prod cannot be a substantially different code path. Every invariant the production server enforces (single ingress, authz before dispatch, audit emission, cache tagging, idempotency) must run the same way in dev. If "dev mode" is a side-quest branch that prod never exercises, prod will eventually break in ways dev never sees.

The existing affordance (`TEST_AUTH_ENABLED=true` + `X-Debug-Principal` header — see [`apps/server/src/middleware/principal.ts:151`](../../apps/server/src/middleware/principal.ts)) closes half the gap: tests can present a fabricated principal. It does not close the rest:

- The dev still has to attach an `X-Debug-Principal` header on every request from the browser. SPA dev with that header is annoying enough to push devs to disable auth checks downstream, which then escapes to prod.
- There's no first-class "dev tenant seeded with sample data" — every dev hand-rolls one.
- There's no first-class signal of "this server is running in a mode where auth is bypassed." Operators looking at a misconfigured prod box have to grep for env vars to know.

The 2026-05-20 user checkpoint chose to land an explicit dev-mode contract — both the affordances and the guards — rather than evolve the test-auth env var ad-hoc until it accidentally ends up in production.

A specific design tension this ADR resolves: **"no auth in dev" can mean two architecturally different things.** Either (a) the auth middleware is *skipped* and downstream handlers see anonymous requests, or (b) the auth middleware *resolves* an unauthenticated request to a real seeded principal. (a) is the path that diverges from prod; (b) is the path where every invariant runs identically to prod. This ADR commits to (b) — **principal injection, not auth bypass.**

## Decision

### 1. Dev-mode is a single named, defaulted-off, guarded contract

A new boolean `config.devMode.enabled` exists in `AppConfig`. It is `false` by default. It becomes `true` only when **every** signal below agrees:

1. The environment variable `ATLAS_DEV_MODE` is exactly the literal string `"true"`. Truthy-ish values (`"1"`, `"yes"`) do not enable it — exact match only, so a misconfigured deployment cannot silently flip it on.
2. `config.environment` is `'development'` or `'test'`. `'staging'` and `'production'` refuse to load with dev-mode requested.
3. `controlPlaneDbUrl` host is one of `localhost`, `127.0.0.1`, `::1`, `*.localhost`, or `*.local`. A control-plane DB on a real network host means this is not a developer laptop — dev mode refuses to boot.
4. `tenantApex` is `localhost`. A tenant apex other than localhost means the server is reachable at a real DNS name; dev mode refuses.
5. The deployment was not built with the compile-time flag `ATLAS_PROD_BUILD=1`. (Stub today — runtime check only; tightens to a build-time tree-shake in a follow-up so prod bundles literally don't ship the dev-principal module.)

Any disagreement: refuse to boot with a loud error that names exactly which signal failed and why. There is no half-on; there is no "best-effort dev mode."

When all five agree, dev-mode is on. When even one disagrees, the server boots with the normal production-shaped auth stack and the dev-principal middleware is inert (or, post-tree-shake, not loaded at all).

### 2. Principal injection — not auth bypass

When dev-mode is on and a request arrives **without** any auth credentials (no `Authorization` header, no session cookie, no `X-Debug-Principal`), the principal middleware resolves it to the seeded dev-admin principal:

- `principalId: dev-admin`
- `tenantId: dev-tenant`
- `roles: ['admin']`

The request then proceeds through the *exact same* downstream middleware as any authenticated request:

- `correlationId` propagation (I5) — unchanged.
- Tenant resolution + cross-check against host header — unchanged.
- Authz evaluation — unchanged. The seeded `dev-admin` has the `admin` role; existing policy adapters (`StubPolicyEngine` allows-all-with-tenant-scope; `CedarPolicyEngine` will evaluate the policy bundle and permit on the `admin` role) make the request authorized. **The policy engine is consulted on every request, in dev exactly as in prod.**
- Idempotency check (I3) — unchanged.
- Handler dispatch + audit emission — unchanged. Every action attributable to the dev-admin principal lands in the audit log with `principalId: dev-admin` and an additional `principalSource: 'dev-injection'` attribute (see §3).

This means: removing dev-mode is one config flip. The injected request resolves to "no principal," the existing 401 fires, nothing else changes.

Conversely, *any* request that brings real credentials in dev mode (a session cookie from a real signup flow, a JWT, `X-Debug-Principal`) takes precedence over the injection. The injection is the no-credentials fallback, not an override.

### 3. The five-layer safety surface

Each layer is independently sufficient to keep dev-mode off in production. Defeating all five is intentional, not accidental.

1. **Multi-signal boot guard** (§1). Five independent agreements required. Loud refusal otherwise.
2. **Separate boot path.** The dev-principal middleware lives in `apps/server/src/middleware/dev-principal.ts`. It is only imported into the auth chain when `config.devMode.enabled === true` (resolved at boot, captured in a closure). The prod path holds a `null` reference and never touches it.
3. **Red boot banner.** When dev-mode comes up, the boot log emits a `Server.Boot.DevModeEnabled` log line at `warn` level with the resolved principal, tenant, and a one-line `auth bypassed — DO NOT EXPOSE` warning. Followed by a `Server.DevMode.Heartbeat` `warn` line every 60s while the server is up. Operators with a working log scrape see this immediately if it shows up where it shouldn't.
4. **Per-request audit attribution.** Every event emitted under the injected principal carries `principalSource: 'dev-injection'` in its attributes. A prod audit pipeline that ever observes that value should treat it as a P0.
5. **Egress trip-wire.** Dev-mode refuses to boot if `tenantApex` is anything other than `localhost` or if the resolved `controlPlaneDbUrl` host is not loopback. This is the same multi-signal guard from §1, restated as an outward-facing constraint: a server reachable from the public internet cannot be in dev-mode.

### 4. Permissive policy is the existing `StubPolicyEngine`

Two policy-engine adapters exist: `StubPolicyEngine` (allow-all-with-tenant-scope, `adapters/policy-stub/src/stub-policy-engine.ts`) and `CedarPolicyEngine`. The dev-mode contract observes:

- The default `POLICY_ENGINE=stub` is the dev permissive default. The dev-admin principal authorized against this engine: every action within `dev-tenant` is permitted; cross-tenant actions are denied. This matches the production posture for *the policy seam* — same engine type, same code path, just a permissive bundle.
- Devs who want to test Cedar locally set `POLICY_ENGINE=cedar` explicitly. The dev-tenant seed bundle ships a permissive Cedar bundle (allows-all for the `admin` role) so the workflow still behaves; the engine difference is the only change.

This is **not** a third "policy bypass" mode. The engine evaluates; the result is permit. The code path is identical to prod. Switching adapter implementations doesn't change which middleware fires or in what order.

### 5. The seed contract — what `pnpm dev:up` guarantees

Running `pnpm dev:up` is a single command that brings the data plane to a known-good state. After it returns successfully, the following are true:

1. `control_plane` database is reachable on `localhost:15433` and its migrations are applied.
2. The `_platform` tenant exists in `control_plane.tenants` and its tenant-DB migrations are applied. The seeded platform-admin User + Membership are present.
3. The `dev-tenant` tenant exists in `control_plane.tenants` with `status='active'`. Its tenant-DB migrations are applied.
4. A `dev-admin` User exists in `dev-tenant` with role `admin` (via a `Membership` row matching the platform-admin shape).
5. The script prints the next command (server start) and the resolved URLs.

The script is **idempotent**. Re-running yields the same end state with no-op writes for already-seeded rows. This mirrors the platform-admin seeding pattern already in `apps/server/src/bootstrap-platform-admin.ts`.

The script is **hand-rolled today** — it issues platform writes directly via the same adapter classes the server uses, not via the ingress pipeline. This is a deliberate choice (see §6). Once [ADR 0014](0014-self-evolving-substrate.md)'s materializer lands, the script becomes a thin caller of `Bundle.Install` targeting a `bundles/dev-tenant/spec.yaml` seed bundle. The replacement is mechanical because both paths converge on the same end state.

### 6. Hand-rolled now; materialized later

Two reasons the script is hand-rolled in this ADR rather than waiting for the materializer:

- **Dev velocity now.** The materializer is scoped under ADR 0014 but not yet built. Blocking dev experience on it means devs hand-roll their own scripts in the meantime, each subtly different. A single canonical hand-rolled script is the lower drift cost.
- **Clean swap later.** The script's end state is a set of database rows; the materializer's end state is the same set of database rows. Whichever path reaches that state, downstream code does not care. The migration is "delete imperative script, add declarative spec," not "rewrite seven things."

The script does **not** introduce any new side door. It uses the existing `PostgresEntityStore` / `PostgresTenantStore` / migration runner that the server itself uses at boot. It runs out-of-process — no HTTP — because the bootstrap problem ("create an admin before you have an admin to authenticate as") is the well-known chicken-and-egg the existing `scripts/tenant-add-admin.ts` already solves the same way.

### 7. What dev-mode does NOT do

Recorded explicitly to bound scope:

- **Dev-mode does not skip quota checks.** Quota dimensions for `dev-admin` resolve normally; the seed gives the dev tenant a generous-but-finite quota so quota code paths are exercised in dev.
- **Dev-mode does not skip idempotency.** I3 holds — the dispatcher still keys off the envelope.
- **Dev-mode does not skip audit.** Every event emits. The `principalSource: 'dev-injection'` attribute is additive.
- **Dev-mode does not allow cross-tenant access.** The dev-admin is scoped to `dev-tenant`. Attempts to act in `_platform` or any other tenant authz-fail the same way they would in prod.
- **Dev-mode does not change the dispatcher chain.** The composed chain in `middleware/state.ts` is identical.
- **Dev-mode does not change adapter selection beyond what env vars already do.** Postgres / Cedar-or-Stub / WorkerMode are read from env; dev-mode does not silently override them.

## Constraints this imposes

1. **Boot-time validation is non-negotiable.** `loadConfig()` MUST run all five guards when `ATLAS_DEV_MODE=true` is present and refuse to boot loudly on any failure. There is no "warn and continue."
2. **The dev-principal middleware MUST live in a single file** (`apps/server/src/middleware/dev-principal.ts`) so it can be tree-shaken in a future hardening pass.
3. **Every audit-emitted event from a dev-injected principal MUST carry `principalSource: 'dev-injection'`.** The attribute is the operational trip-wire; without it, the safety surface has four layers, not five.
4. **The boot banner is mandatory.** Devs and operators must see "auth bypassed" the moment the server comes up. Suppressing the banner is a defect.
5. **`pnpm dev:up` MUST be idempotent.** Re-runs against an already-seeded dev DB produce no error, no duplicate rows, no `ON CONFLICT` exception that aborts.
6. **The seeded dev-admin's `tenantId` MUST equal `dev-tenant`.** Hard-coded; not configurable. A configurable dev-admin tenant is a foot-gun (`ATLAS_DEV_TENANT_ID=_platform` would let the dev tenant pollute the platform tenant).
7. **`pnpm dev:up` MUST run only against a loopback control-plane DB.** Same guard as §1 #3. The script itself refuses to run otherwise — the safety surface is not exclusively the server's responsibility.

## Consequences

**Positive:**

- New devs onboard in three commands (`pnpm install` → `make db-up` → `pnpm dev:up`) and have a working power-admin session in a seeded tenant. The agentic-first tenet from [ADR 0003](0003-tenant-defined-data-model-pivot.md) §3 gets a concrete onboarding artifact: an agent run against `localhost:3000` can issue any intent immediately, with no token exchange.
- Every invariant in prod runs in dev. The "principal injection, not bypass" choice means I1, I2, I3, I5, I9, I10, I13, I17 all hold identically across modes. Switching to a real OIDC provider in staging/prod changes exactly one config knob.
- Dev mode is loud. If a misconfigured deployment ever brings up dev mode in prod, the boot banner + per-event `principalSource` makes detection trivial; the five-signal guard makes the misconfiguration itself nearly impossible.
- The hand-rolled seed script is a stepping stone, not a parallel path. The materializer ([ADR 0014](0014-self-evolving-substrate.md)) replaces it without changing what dev-mode looks like to the user.

**Negative:**

- Five layers is more guards than any single change needs in isolation; the cost is added boot-time complexity in `config.ts`. The alternative (one env var, hope) has been the industry default for decades and produces the incidents this contract exists to prevent.
- The compile-time `ATLAS_PROD_BUILD=1` strip is a stub today. Until it's wired, the dev-principal module exists in production bundles even though it's runtime-inert. A determined attacker with code-execution on a prod host could flip the runtime guard. Mitigated by the other four layers; tightened in a follow-up slice.
- A configurable dev-admin (different tenantId, different role set) is forbidden. Some flows ("test what happens when dev runs as a non-admin") cannot use dev-mode; they use `X-Debug-Principal` instead. This is the right tradeoff — making dev-mode configurable opens the configurability to misuse in prod.
- The 60-second heartbeat is logging noise in long-running dev sessions. Acceptable: dev sessions are usually short and the noise is the point.

**Out of scope:**

- **Compile-time tree-shake** of the dev-principal module — landed as a follow-up hardening slice once the build pipeline supports conditional bundling.
- **`atlasctl tenant {create,reset,destroy}`** — surfaces the dev-up script's primitives via the operator CLI. Useful but not required for the MVP onboarding flow. Filed as a follow-up.
- **Configurable dev principal** — forbidden, see Consequences.
- **Multi-dev-tenant onboarding** — the script seeds one canonical dev tenant. Devs who want a second isolated tenant either re-run the script with `DEV_TENANT_ID=<other>` (planned, not in MVP) or use the CLI surface above.
- **OAuth/JWT dev mode** — devs who want to test the real OIDC path turn off dev-mode and run a local Keycloak. Dev-mode is the "no auth" affordance; it is not a replacement for the OIDC integration tests.
- **Browser-side dev-mode banner** — the SPA shells render a banner when `VITE_DEV_MODE_BANNER=true` (planned, not in MVP). The server-side log banner is the load-bearing signal; the SPA banner is operator ergonomics.
- **Tightening to require `ATLAS_DEV_TENANT_ID` to NOT collide with any real tenant** — the script reserves the `dev-` prefix in `control_plane.tenants` by convention; enforcement is a follow-up.

## Migration

1. **This ADR (spec-only piece):** records the decision.
2. **Config patch:** `apps/server/src/config.ts` gains a `DevModeConfig` block + a `validateDevMode()` that runs the five-signal guard.
3. **Dev-principal middleware:** `apps/server/src/middleware/dev-principal.ts` (new file, single export, idle when `config.devMode.enabled` is `false`).
4. **Principal middleware wiring:** `apps/server/src/middleware/principal.ts` gains one new fallthrough step — after every auth scheme has been tried and before the 401 fires, if `config.devMode.enabled` and no credentials were presented, inject the dev principal. One added if-block, no restructuring.
5. **Bootstrap banner:** `apps/server/src/bootstrap.ts` logs `Server.Boot.DevModeEnabled` when `devMode.enabled`. Heartbeat in `main.ts` (or wherever the SIGINT loop lives).
6. **Seed script:** `scripts/dev-up.ts` lands. `pnpm dev:up` in root `package.json`.
7. **Lexicon patch:** `specs/LEXICON.md` adds `DevMode`, `DevPrincipal`, `DevTenant` as named concepts. Lands with the seed script.
8. **Follow-up tickets** (deferred): compile-time strip, `atlasctl tenant ...` commands, materialized seed bundle replacing the hand-rolled script.

## Cross-references

- Vision tenet this serves: [`vision.md`](../vision.md) §"What Atlas is" — agentic-first means the first interaction has to be frictionless.
- The principal-resolution code path this extends: [`apps/server/src/middleware/principal.ts`](../../apps/server/src/middleware/principal.ts).
- The pattern this script imitates for one-shot bootstraps that bypass HTTP for chicken-and-egg reasons: [`scripts/tenant-add-admin.ts`](../../scripts/tenant-add-admin.ts).
- The seed-bundle pattern this script will eventually become: [`0014-self-evolving-substrate.md`](0014-self-evolving-substrate.md) Part B.
- Recursive-kernel principle this respects (the dev-tenant is a tenant like any other): [`0008-atlas-on-atlas.md`](0008-atlas-on-atlas.md).
- Authz seam this does not weaken: [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) I2 / I13.
