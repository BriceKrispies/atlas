# Atlas Platform

Multi-tenant CMS + workflow platform. **TypeScript-first** (Node + browser).
Hexagonal architecture: ports define the surface, adapters implement them, modules
hold domain logic, packages are shared infrastructure, apps wire it all together.

A legacy Rust implementation lives under `/crates`. It is being deprecated as
features port to TS — **prefer the TS side; do not extend `/crates`** unless the
user explicitly asks.

## Agent Routing — Where to Go

Pick the closest match and read its CLAUDE.md before working in that area.

| Your task involves... | Read this |
|-----------------------|-----------|
| Implementing or wiring port interfaces (DBs, caches, search, policy) | [`adapters/CLAUDE.md`](adapters/CLAUDE.md) |
| Defining or changing a port (the abstraction itself) | [`ports/CLAUDE.md`](ports/CLAUDE.md) |
| Domain logic — handlers, projections, queries, events | [`modules/CLAUDE.md`](modules/CLAUDE.md) |
| Anything UI: components, surfaces, signals, design tokens | [`packages/CLAUDE.md`](packages/CLAUDE.md) |
| The base `AtlasElement` primitive, signals, html template | [`packages/core/CLAUDE.md`](packages/core/CLAUDE.md) |
| Adding or changing a custom web component | [`packages/design/CLAUDE.md`](packages/design/CLAUDE.md) |
| Server / frontends — routes, shells, dev wiring | [`apps/CLAUDE.md`](apps/CLAUDE.md) |
| HTTP server (Hono) — routes, middleware, bootstrap | [`apps/server/CLAUDE.md`](apps/server/CLAUDE.md) |
| BDD / Playwright e2e | [`tests/bdd/README.md`](tests/bdd/README.md) |
| Specifications — source of truth for behavior | [`specs/CLAUDE.md`](specs/CLAUDE.md) |
| Containers / compose / dev infrastructure | [`infra/CLAUDE.md`](infra/CLAUDE.md) |
| **Legacy Rust** — only if user explicitly asks | [`crates/CLAUDE.md`](crates/CLAUDE.md) |

## Top-level Layout

```
adapters/   port implementations (idb, node-postgres, policy-cedar, policy-stub)
ports/      @atlas/ports — port interfaces only
modules/    domain logic (authz, catalog, content-pages)
packages/   shared infra: core, design, widgets, ingress, schemas, …
apps/       runnable units: server (Hono), admin, authoring, sandbox, control-plane (Rust)
tests/      bdd, parity, integration, blackbox (Rust)
specs/      RFC-style specs and lexicon — the source of truth
infra/      compose files, container runtime
crates/     LEGACY Rust — being phased out, do not extend
```

## Domain Map

Atlas is structured as **26 business domains** grouped into **5 platforms**.
**Domains** are the agent-ownership unit — one agent owns a capability inside a
domain end-to-end (spec → BDD → modules → adapters → UI). **Platforms** are a
doc-level grouping for narrative; they are not a folder layer.

Each domain's spec home is `specs/domains/<domain>/`. BDD feature folders under
`tests/bdd/features/<domain>/` are created lazily — only when a scenario exists.

| Platform | Domain | Spec home |
|----------|--------|-----------|
| **Spine** | identity | [`specs/domains/identity/`](specs/domains/identity/) |
| **Spine** | authorization | [`specs/domains/authorization/`](specs/domains/authorization/) |
| **Spine** | tenancy | [`specs/domains/tenancy/`](specs/domains/tenancy/) |
| **Spine** | organization | [`specs/domains/organization/`](specs/domains/organization/) |
| **Spine** | audit | [`specs/domains/audit/`](specs/domains/audit/) |
| **Spine** | observability | [`specs/domains/observability/`](specs/domains/observability/) |
| **Spine** | search | [`specs/domains/search/`](specs/domains/search/) |
| **Content** | authoring | [`specs/domains/authoring/`](specs/domains/authoring/) |
| **Content** | delivery | [`specs/domains/delivery/`](specs/domains/delivery/) |
| **Content** | media | [`specs/domains/media/`](specs/domains/media/) |
| **Content** | maps | [`specs/domains/maps/`](specs/domains/maps/) |
| **Content** | catalog | [`specs/domains/catalog/`](specs/domains/catalog/) |
| **Content** | widgets | [`specs/domains/widgets/`](specs/domains/widgets/) |
| **Content** | forms | [`specs/domains/forms/`](specs/domains/forms/) |
| **Content** | localization | [`specs/domains/localization/`](specs/domains/localization/) |
| **Workflow** | automation | [`specs/domains/automation/`](specs/domains/automation/) |
| **Workflow** | rules | [`specs/domains/rules/`](specs/domains/rules/) |
| **Workflow** | scheduling | [`specs/domains/scheduling/`](specs/domains/scheduling/) |
| **Workflow** | approvals | [`specs/domains/approvals/`](specs/domains/approvals/) |
| **Workflow** | import-export | [`specs/domains/import-export/`](specs/domains/import-export/) |
| **Engagement** | communications | [`specs/domains/communications/`](specs/domains/communications/) |
| **Engagement** | notifications | [`specs/domains/notifications/`](specs/domains/notifications/) |
| **Engagement** | analytics | [`specs/domains/analytics/`](specs/domains/analytics/) |
| **Engagement** | experimentation | [`specs/domains/experimentation/`](specs/domains/experimentation/) |
| **Engagement** | gamification | [`specs/domains/gamification/`](specs/domains/gamification/) |
| **Commerce** | billing | [`specs/domains/billing/`](specs/domains/billing/) |

Most stubs are TODO. Several point at legacy spec content under
`specs/modules/*` or `specs/crosscut/*` that hasn't migrated yet — see
[`specs/CLAUDE.md`](specs/CLAUDE.md) for the legacy → canonical mapping.

## Capability Onboarding

If you've been told "work on capability X in domain Y," read these in order
before writing code. The whole stack converges on this list.

1. **The capability spec** — `specs/domains/<domain>/capabilities/<capability>/README.md` (purpose, scope, surfaces, invariants touched). If the file doesn't exist yet, the capability hasn't been scoped — escalate.
2. **The request lifecycle** — [`specs/lifecycle.md`](specs/lifecycle.md). 5-minute end-to-end trace of how an intent flows through the stack and how reads come back. **Mandatory** if you're touching anything backend.
3. **Module conventions** — [`modules/CLAUDE.md`](modules/CLAUDE.md). Handler / projection / dispatcher / query patterns + the cache-invalidation contract.
4. **Frontend conventions** — [`packages/core/CLAUDE.md`](packages/core/CLAUDE.md) for `AtlasElement` / `AtlasSurface` / signals; [`packages/design/CLAUDE.md`](packages/design/CLAUDE.md) when adding a new component.
5. **BDD contract** — [`tests/bdd/README.md`](tests/bdd/README.md) for the feature/step layout and surface-state assertions.
6. **Architecture invariants** — [`specs/architecture.md`](specs/architecture.md). Every capability must respect I1–I12.

## Quick Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Frontend dev — admin | `pnpm dev` |
| Frontend dev — authoring | `pnpm authoring` |
| Frontend dev — sandbox | `pnpm sandbox` |
| Server (apps/server) | `pnpm --filter @atlas/server dev` |
| Typecheck | `pnpm typecheck` |
| Unit tests | `pnpm test` |
| E2E (Playwright) | `pnpm test:e2e` |
| BDD (Playwright + Gherkin) | `pnpm bdd` |
| Lint | `pnpm lint` |
| DB up (Postgres) | `make db-up` |
| Spec validation | `make spec-check` |

## Non-Negotiable Invariants

Architectural laws — violating any is a bug. Full definitions in `specs/architecture.md`.

- **I1**: All requests go through the single ingress chokepoint — no other module/package exposes HTTP
- **I2**: Authorization runs BEFORE execution — no side effects on denied requests
- **I3**: Idempotency checked before handler dispatch
- **I4**: Deny-overrides-allow in policy evaluation
- **I5**: `correlationId` propagates through the entire request flow
- **I7**: Tenant isolation in search — `tenantId` always in scope
- **I9**: Cache keys MUST include `tenantId` (unless explicitly PUBLIC)
- **I10**: Cache invalidation is event-driven via tag-based purging, not TTL
- **I12**: Projections must be rebuildable from event history alone

## Core Concepts

- **Port** — an interface in `/ports`. Defines a capability (e.g., `EventStore`, `Cache`).
- **Adapter** — an implementation in `/adapters`. Each adapter satisfies one or more ports.
- **Module** — domain logic in `/modules`. Pure functions over ports — no I/O of its own.
- **AtlasElement** — base class for every UI element (`packages/core`). Extends `HTMLElement`. Components live in `packages/design`.
- **AtlasSurface** — top-level surface (page / widget / dialog) that owns load state and provides `surfaceId` for nested elements.

### Enforcement bars

These two rules are non-negotiable. They show up in nearly every code review:

- **`AtlasElement` is the only base class for UI elements.** Bare `HTMLElement`, framework components (Lit/React/Vue), or wrapper classes are not allowed in Atlas frontend code. New components belong in [`packages/design/`](packages/design/CLAUDE.md).
- **`apps/server` is the only HTTP boundary.** Every other app (admin, authoring, sandbox) is a *client* of it. No other package or app may expose HTTP endpoints (Invariant **I1**). The full request flow is traced in [`specs/lifecycle.md`](specs/lifecycle.md).

## Gotchas

- **Podman, not Docker.** Container runtime defaults to Podman. `CONTAINER_RUNTIME=docker` to override.
- **Module IDs are kebab-case.** Workspace names use `@atlas/<name>`; module dirs match.
- **`/crates` is legacy.** Don't add features there. The TS side is authoritative.
- **DB connection** (server): `CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/control_plane`. Host port `15433` is intentional — picked outside the standard 5432/5433 range to dodge native-Postgres collisions on dev machines. See [`PORTS.md`](PORTS.md).
- **`X-Debug-Principal`** header is gated by `TEST_AUTH_ENABLED=true` and only valid in non-prod.

## Key Reference Files

| File | What it contains |
|------|-----------------|
| `specs/architecture.md` | Principles P1–P6, Invariants I1–I12, full system design |
| `specs/LEXICON.md` | Canonical vocabulary — nouns, verbs, pipelines |
| `specs/normative_requirements.md` | RFC 2119 compliance rules |
| `SYSTEM_MAP.md` | Deep AI-agent exploration guide with request traces |
| `PROGRESS.md` | What's implemented vs. stubbed vs. missing |
| `features.md` | High-level feature list |
