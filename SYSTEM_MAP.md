# SYSTEM_MAP.md

> Compact deep-dive guide for AI agents. Every claim cites a real file or
> directory in the current TypeScript codebase. The Rust prototype was
> deleted on 2026-05-04 — anything mentioning `crates/`, `cargo`, `axum`,
> or `wasmtime` is stale and should be ignored.

---

## A. One-Screen Overview

**What this repo is.** Multi-tenant CMS + workflow platform built on a
hexagonal (ports/adapters) architecture with CQRS and event-sourced
projections. Code is TypeScript end-to-end (Node + browser). Specs are the
source of truth; see `specs/CLAUDE.md`.

**Get it running locally.**
```bash
pnpm install
make db-up                       # Postgres on host port 15433 (Podman)
pnpm --filter @atlas/server dev  # Hono server on :3000
pnpm dev                         # Admin shell (Vite)
pnpm test                        # Unit tests
pnpm bdd                         # Playwright + Gherkin
make spec-check                  # Spec/fixture validation
```

Evidence: `package.json`, `Makefile`, `apps/server/package.json`.

---

## B. Workspace Layout

```
atlas/
├── adapters/           Port implementations
│   ├── idb/            Browser IndexedDB
│   ├── node-postgres/  Server Postgres
│   ├── policy-cedar/   Cedar policy engine adapter
│   └── policy-stub/    Allow-all stub for tests/dev
├── apps/
│   ├── admin/          Admin shell (Vite + AtlasElement)
│   ├── authoring/      Authoring shell
│   ├── sandbox/        Component sandbox / playground
│   ├── server/         Hono HTTP server (sole HTTP boundary, I1)
│   └── projection-worker/  Async projection worker
├── modules/            Pure domain logic (no I/O imports)
│   ├── authz/          Policy CRUD + Cedar bundle integration
│   ├── catalog/        Taxonomies / families / variants
│   ├── content-pages/  Page CRUD + render-tree projection
│   └── identity/       Users / sessions / API keys / OAuth
├── packages/           Shared infra
│   ├── core/           AtlasElement, signals, html template
│   ├── design/         Component library
│   ├── widgets/        Higher-order widgets
│   ├── ingress/        Submit-intent pipeline (the I1 chokepoint logic)
│   ├── platform-core/  EventEnvelope, IntentEnvelope, common types
│   └── schemas/        JSON Schema contracts
├── ports/              @atlas/ports — port interfaces only
├── specs/              RFC-style specs (source of truth)
├── tests/
│   ├── bdd/            Playwright + Gherkin features
│   └── parity/         Historical (Rust↔TS parity, deletion candidate)
└── infra/              Compose files for Postgres dev stack
```

---

## C. Architecture Landmarks

### Source-of-truth docs

| Doc | Purpose |
|---|---|
| `specs/architecture.md` | Principles P1-P6, Invariants I1-I12 |
| `specs/lifecycle.md` | 5-min end-to-end request trace (WRITE + READ paths) |
| `specs/normative_requirements.md` | RFC 2119 compliance rules |
| `specs/LEXICON.md` | Canonical vocabulary |
| `specs/glossary.md` | Concept definitions |
| `CLAUDE.md` (root) | Agent routing — which CLAUDE.md to read for which task |

### Code landmarks

| Component | Location |
|---|---|
| HTTP entry | `apps/server/src/index.ts` |
| Submit-intent pipeline | `packages/ingress/src/submit-intent.ts` |
| Principal middleware (cookie/bearer) | `apps/server/src/middleware/principal.ts` |
| Module-state composition | `apps/server/src/middleware/state.ts` |
| Event envelope / intent envelope types | `packages/platform-core/src/` |
| Port interfaces | `ports/src/` |
| Postgres adapters | `adapters/node-postgres/src/` |
| Cedar policy adapter | `adapters/policy-cedar/src/` |
| Async projection worker | `apps/projection-worker/src/tenant-loop.ts` |

---

## D. Runtime Request Flow (WRITE path)

For the canonical full trace see `specs/lifecycle.md`. Compact version:

```
1. POST /api/v1/intents
   └── apps/server/src/index.ts (Hono routes)

2. Principal middleware
   └── apps/server/src/middleware/principal.ts
   └── Resolves Principal from:
       - Session cookie  (validates AuthSession entity, status, expiries)
       - API-key bearer  (atlas_<keyId>_<secret>, parseApiKeyBearer)
       - OAuth bearer    (OAuthAccessToken entity)
       - X-Debug-Principal header (TEST_AUTH_ENABLED only)

3. Submit-intent pipeline
   └── packages/ingress/src/submit-intent.ts
   ├── 4. Idempotency-key non-empty check  (I3 — full lookup landing in A2-hardening)
   ├── 5. Schema validation (action payload)
   ├── 6. Authorization (PolicyEngine.evaluate)  (I2, I4)
   ├── 7. Tenant-match assertion  (I9 prep)
   └── 8. Handler dispatch
        └── modules/<x>/src/handlers/registry.ts

4. Handler
   └── modules/<x>/src/handlers/<action>.ts
   └── Validates payload, reads ports, emits primary EventEnvelope (+ optional follow-ups)

5. Event-store append
   └── ports/src/event-store.ts → adapters/node-postgres/src/event-store.ts

6. Dispatcher chain (inline by default — WORKER_MODE)
   └── apps/server/src/middleware/state.ts
   ├── module dispatchers   (modules/<x>/src/dispatch.ts) rebuild projections
   ├── cacheTagDispatcher   purges by cacheInvalidationTags  (I10)
   └── SSE broadcast        notifies live frontends

7. 202 Accepted
   └── { eventId, tenantId, correlationId }
```

**Async mode.** Set `WORKER_MODE=async`. The handler returns 202; events
flow into `apps/projection-worker/src/tenant-loop.ts`, which runs the
identical dispatcher chain. Composition must stay in sync between the two
locations.

---

## E. Read Path

```
1. GET /api/v1/<resource>   (apps/server/src/routes/*.ts)
2. Principal middleware     (same as write)
3. Tenant-scoped query      (modules/<x>/src/queries.ts)
4. Cache lookup             (port: ports/src/cache.ts)
5. Projection store read    (port: ports/src/projection-store.ts)
6. JSON response
```

Cache keys MUST include `tenantId` (I9). Cache is invalidated by tag, not
TTL (I10) — handlers are responsible for handwritten
`cacheInvalidationTags` on every event they emit.

---

## F. Identity Module — Detailed Map

The largest active surface today. Implemented over phases A1 → A2.9.

### Entities (L3 substrate)
- `User` — `modules/identity/src/entities/user.ts`
- `Membership` — `modules/identity/src/entities/membership.ts`
- `InviteToken` — `modules/identity/src/entities/invite-token.ts`
- `AuthSession` — `modules/identity/src/entities/auth-session.ts`
- `ApiKey` — `modules/identity/src/entities/api-key.ts`
- `ServicePrincipal` — `modules/identity/src/entities/service-principal.ts`
- `OAuthAccessToken` — `modules/identity/src/entities/oauth-token.ts`

### Handlers (registered in `modules/identity/src/handlers/registry.ts`)

| Action | Handler |
|---|---|
| `Identity.User.Create` | `user-create.ts` |
| `Identity.Membership.Create` | `membership-create.ts` |
| `Identity.Invite.Issue` | `invite-issue.ts` |
| `Identity.Invite.Accept` | `invite-accept.ts` |
| `Identity.User.SetPassword` | `password-set.ts` |
| `Identity.Login.Password` | `password-login.ts` |
| `Identity.AuthSession.Issue` | `session-issue.ts` |
| `Identity.AuthSession.Refresh` | `session-refresh.ts` |
| `Identity.AuthSession.Revoke` | `session-revoke.ts` |
| `Identity.AuthSession.RevokeAllForUser` | `session-revoke.ts` |
| `Identity.ApiKey.Create / Rotate / Revoke` | `api-key-*.ts` |
| `Identity.ServicePrincipal.Create / SetScopes / Disable` | `service-principal.ts` |

### Out-of-band (RFC 6749) routes

OAuth issue/revoke run on dedicated `/oauth/token` and `/oauth/revoke`
routes (wire shape is RFC 6749, not Atlas intent envelope). Direct exports
in `modules/identity/src/index.ts`: `oauthIssueToken`, `oauthRevokeToken`.

### Crypto helpers
- `crypto/password.ts` — Argon2id (`hashPassword`, `verifyPassword`, `validatePasswordComplexity`)
- `crypto/secret-hash.ts` — `generateSecret` (256-bit), `hashSecret` (SHA-256), `lookupOf`, `constantTimeEqual`

### Test surfaces
- `acceptance.test.ts` — A1 acceptance
- `a2-acceptance.test.ts` — A2 acceptance
- `password.test.ts` — Argon2id + lockout
- `session.test.ts` — issue/refresh/revoke + rotation + reuse-detection
- `handlers.test.ts` — registry-level dispatch
- `role-packs.test.ts` — Cedar role-pack bundle

---

## G. Data & Storage

| Store | Adapter | Notes |
|---|---|---|
| Event store | `adapters/node-postgres/src/event-store.ts` | Append-only, tenant-scoped |
| Entity store (L3 substrate) | `adapters/node-postgres/src/entity-store.ts` | Document + edges |
| Projection store | `adapters/node-postgres/src/projection-store.ts` | Read models |
| Cache | `adapters/node-postgres/src/cache.ts` (or in-memory in dev) | Tag-based purge |
| Search | TBD (port defined in `ports/src/search-engine.ts`) | |

**Default Postgres URL** (server):
`CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/control_plane`.
Host port `15433` is intentional — avoids collisions with native Postgres
on dev machines. See `PORTS.md`.

---

## H. Testing

| Type | Command | Location |
|---|---|---|
| Unit | `pnpm test` | `modules/<x>/test/`, `packages/<x>/test/` |
| Typecheck | `pnpm typecheck` | repo-wide |
| Lint | `pnpm lint` | repo-wide |
| BDD (Playwright + Gherkin) | `pnpm bdd` | `tests/bdd/features/` |
| E2E | `pnpm test:e2e` | Playwright |
| Spec/fixture validation | `make spec-check` | `specs/fixtures/` |

`tests/parity/` (historical Rust↔TS parity) is a deletion candidate.

---

## I. Operations & Tooling

### Make targets

| Category | Targets |
|---|---|
| Database | `db-up`, `db-down`, `db-migrate`, `db-seed`, `db-reset` |
| Specs | `spec-check` |

### Compose files

| File | Purpose |
|---|---|
| `infra/compose/compose.control-plane.yml` | Postgres + Keycloak dev stack |

### CLIs

| Tool | Status |
|---|---|
| `atlasctl` (operator CLI) | Rust prototype deleted; TS rewrite TBD |

---

## J. "Where to Change X" Quick Index

| Intent | Location |
|---|---|
| Add new intent action | 1. Handler in `modules/<x>/src/handlers/<action>.ts`<br>2. Register in `modules/<x>/src/handlers/registry.ts`<br>3. Schema in `packages/schemas/` |
| Add new schema | `packages/schemas/src/` (Zod) + `specs/schemas/contracts/<name>.schema.json` if it's spec-tracked |
| Change authz policy semantics | `modules/authz/src/policy/evaluate.ts`, `adapters/policy-cedar/src/` |
| Add a projection | New file under `modules/<x>/src/projections/`; wire in `modules/<x>/src/dispatch.ts` |
| Change ingress validation | `packages/ingress/src/submit-intent.ts` |
| Add new event type | `packages/platform-core/src/event-envelope.ts` types + module-level emit site |
| Add new port | Trait in `ports/src/<name>.ts`, in-memory in test fixtures, real impl in `adapters/<name>/` |
| Add new HTTP route | `apps/server/src/routes/<name>.ts` + register in `apps/server/src/index.ts` |
| Add component | New file in `packages/design/src/components/` extending `AtlasElement` |

---

## K. Invariant → Code Map

| Invariant | Where enforced |
|---|---|
| I1 single ingress | `apps/server/src/index.ts` is the only HTTP-bound app |
| I2 authz before exec | `packages/ingress/src/submit-intent.ts:186-306` (before handler dispatch) |
| I3 idempotency before exec | `packages/ingress/src/submit-intent.ts:170-329` (non-empty check today; full lookup in A2-hardening) |
| I4 deny-overrides-allow | `modules/authz/src/policy/evaluate.ts`, `adapters/policy-cedar/` |
| I5 correlation propagation | `IntentHandlerContext.correlationId` threaded through every handler |
| I7 tenant isolation in search | Search adapter takes `tenantId` in scope |
| I9 cache key tenant scope | `cacheInvalidationTags` always include `Tenant:${tenantId}` |
| I10 event-driven invalidation | `cacheTagDispatcher` in `apps/server/src/middleware/state.ts` |
| I12 rebuildable projections | Each `modules/<x>/src/dispatch.ts` is pure-function over events |

---

## L. Known Gaps

- **Async outbox / message bus.** Inline + per-tenant async loops exist; no Kafka/NATS adapter.
- **Per-tenant DBs.** Tenancy is a column today, not a schema.
- **Rate limiting at ingress.** Per-user lockout exists for password-login; no IP/global throttle.
- **Search engine adapter.** Port defined; no real adapter beyond in-memory.
- **`atlasctl` CLI.** Rust prototype deleted; TS rewrite TBD.
- **Identity Phase A3+.** OIDC, magic-link, password reset, MFA, WebAuthn, SAML — see `PROGRESS.md` and `specs/domains/identity/authn.md`.
