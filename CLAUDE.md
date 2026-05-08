# Atlas Platform

Self-hosted multi-tenant **developer platform**. A tenant signs up, pushes code, gets backend resources provisioned (compute, storage, DNS, secrets), and runs workflows on the platform. **TypeScript** (Node + browser). Hexagonal architecture: ports define the surface, adapters implement them, modules hold domain logic, packages are shared infrastructure, apps wire it all together.

See [`specs/vision.md`](specs/vision.md) for the user-facing vision and [`specs/decisions/0002-developer-platform-domain-map.md`](specs/decisions/0002-developer-platform-domain-map.md) for how the domain map was re-anchored from a CMS-flavored shape to this developer-platform shape on 2026-05-08.

A previous Rust prototype under `/crates`, `/tools/cli`, `/apps/control-plane`, and `/tests/blackbox` has been removed. Some specs still reference Rust paths as historical context — treat those as legacy notes, not active code locations.

Strategy is to **wrap existing tools as adapters** (k3s, kaniko, Caddy, Hetzner Cloud, Gitea, MinIO, etc.) — Atlas's value-add is the developer UX + the multi-tenant glue + unified audit + a single CLI (`atlasctl`).

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

## Agent Roster

Project agents live in [`.claude/agents/`](.claude/agents/) and are invoked via the Agent tool's `subagent_type`. Use the closest match; agents reference the relevant CLAUDE.md / spec rather than duplicating it.

**Governance / cross-cut**

| Agent | When to delegate |
|-------|------------------|
| [`architect`](.claude/agents/architect.md) | Design reviews; any change touching I1–I12, P1–P6, hexagonal layering, ingress, authz precedence, cache invalidation, or tenant scoping |
| [`spec-keeper`](.claude/agents/spec-keeper.md) | Scoping new capabilities, adding normative rules, lexicon changes, migrating legacy spec content into `specs/domains/<x>/` |

**Platform owners (one per platform — spec/design authority, not implementer)**

| Agent | Owns |
|-------|------|
| [`spine-owner`](.claude/agents/spine-owner.md) | identity, authorization, tenancy, organization, audit, observability, search |
| [`compute-owner`](.claude/agents/compute-owner.md) | cluster, runtime, image-build, ingress, dns |
| [`storage-owner`](.claude/agents/storage-owner.md) | object-storage, block-storage, secrets |
| [`code-owner`](.claude/agents/code-owner.md) | repository, pipeline, artifact-registry |
| [`workflow-owner`](.claude/agents/workflow-owner.md) | triggers, scheduling, jobs, function-runner, approvals |
| [`commerce-owner`](.claude/agents/commerce-owner.md) | billing, quotas, metering, plans |
| [`first-party-apps-owner`](.claude/agents/first-party-apps-owner.md) | parked CMS (`apps/cms/`) and any future first-party tenant-installable apps |

**Implementation devs**

| Agent | When to delegate |
|-------|------------------|
| [`module-dev`](.claude/agents/module-dev.md) | New handlers/projections/queries/dispatchers in `/modules` + matching `apps/server` route wiring |
| [`port-adapter-dev`](.claude/agents/port-adapter-dev.md) | Adding/changing a port; implementing in `adapter-node`, `adapter-idb`, `adapter-policy-cedar`, `adapter-policy-stub`; migrations + parity |
| [`frontend-dev`](.claude/agents/frontend-dev.md) | Any UI work — components, surfaces, signals, design tokens, Vite app shells |

**Quality**

| Agent | When to delegate |
|-------|------------------|
| [`sdet`](.claude/agents/sdet.md) | Adversarial test review — finds untested branches, cache-tag gaps, projection rebuild gaps, surface-state assertion holes; pushes back on hard-to-test designs |

**Typical flow for a new capability:** `spec-keeper` (scope) → relevant platform owner (design) → `module-dev` + `frontend-dev` + `port-adapter-dev` (implement) → `sdet` (adversarial review) → `architect` (invariant gate before merge).

## Slice Workflow

The protocol for using the agents above. **Slice = one capability** — exactly one `specs/domains/<domain>/capabilities/<name>/README.md`. Multiple capabilities = multiple slices.

```
Phase 0 — Scope
  spec-keeper + relevant platform-owner
  copy specs/_capability-template.md → specs/domains/<domain>/capabilities/<name>/README.md
  Gate: spec lists invariants touched, surfaces, lexicon hits, file-by-file plan
  ▸ User checkpoint: spec approved before any code

Phase 1 — Implement (parallel where applicable)
  module-dev        → handler + projection + query + dispatch test + cache tags + route
  port-adapter-dev  → any new port + node/idb parity + migrations
  frontend-dev      → surface + components + test-state reader
  Gate: pnpm typecheck + pnpm test green; cache tags asserted; I12 dispatch test exists

Phase 2 — Adversarial review (single pass, not ping-pong)
  sdet → hunts cache-tag gaps, projection rebuild gaps, tenant-isolation holes,
         surface-state assertion gaps, untested branches; writes missing tests
         or files specific feedback
  Gate: BDD scenarios cover the capability; surface states all asserted

Phase 3 — Invariant gate (single pass)
  architect → reviews against I1–I12, hexagonal layering, AtlasElement bar,
              worker parity; reports violations with invariant ID + file:line
  No override: invariant violation = back to Phase 1 or escalate to user

Phase 4 — Optional security review
  /security-review skill (when change touches authn/authz/tenant scope/secrets/PII)

Phase 5 — User checkpoint → merge
  Human breaks ties, decides edge cases, holds the merge button
```

### Anti-slop principles

1. **Spec-first hard gate.** No code without a capability README at the canonical path.
2. **Slice = one capability.** The spec defines scope; the LOC follows. Multiple capabilities = multiple slices.
3. **Tool-checkable definition of done.** `pnpm typecheck` + `pnpm test` (with cache-tag and I12 assertions named in tests) + `pnpm bdd` for surfaces. Every "done" claim is verified by these.
4. **Adversarial pass is mandatory and time-boxed.** SDET runs every slice; one pass; produces a green report or specific feedback. Not optional, not infinite.
5. **Invariant gate is non-negotiable.** Architect rejects on I1–I12 violation; user is the only override.
6. **User checkpoints at boundaries.** Spec approval before code; final approval before merge. Bypass and you're the one shipping the slop.

### Mechanically-checked invariants every slice

- Every emitted event includes `cacheInvalidationTags` with `Tenant:${tenantId}` (I10)
- Every dispatcher has a `dispatch.ts` test rebuilding projections from synthetic events (I12)
- `apps/server/src/middleware/state.ts` and `apps/projection-worker/src/tenant-loop.ts` stay mirrored
- No adapter imports in `/modules`; no HTTP outside `apps/server` (I1, hexagonal)
- Every new component extends `AtlasElement`; no Lit/React/Vue/bare HTMLElement

### Orchestration notes

- Main Claude orchestrates; subagents return one summary each — they don't talk peer-to-peer.
- Phase 1 agents run in parallel when the slice spans backend + frontend + new port (single message, multiple Agent calls).
- Phases 2 and 3 are single-pass. If feedback fires, the dev fixes once and re-runs Phase 1 gates. The user is the tiebreaker — no infinite review loops.

The capability template lives at [`specs/_capability-template.md`](specs/_capability-template.md). Modeled on [`specs/domains/tenancy/capabilities/custom-domains/README.md`](specs/domains/tenancy/capabilities/custom-domains/README.md) — read that as the worked example.

## Top-level Layout

```
adapters/   port implementations (idb, node, policy-cedar, policy-stub)
ports/      @atlas/ports — port interfaces only
modules/    domain logic (authz, catalog, content-pages, identity)
packages/   shared infra: core, design, widgets, ingress, schemas, …
apps/       runnable units: server (Hono), admin, authoring, sandbox, projection-worker, sim
tests/      bdd (Playwright + Gherkin)
specs/      RFC-style specs and lexicon — the source of truth
infra/      compose files, container runtime
```

## Domain Map

Atlas is structured as **6 platforms + 1 parked-apps platform**, each containing several **domains**. Domains are the agent-ownership unit — one agent (or platform owner) owns a capability inside a domain end-to-end (spec → BDD → modules → adapters → UI). Platforms are a doc-level grouping for narrative; they are not a folder layer.

Each domain's spec home is `specs/domains/<domain>/`. BDD feature folders under `tests/bdd/features/<domain>/` are created lazily — only when a scenario exists.

This map was re-anchored on 2026-05-08 from a CMS / SaaS-framework shape to a developer-platform shape. See [`specs/decisions/0002-developer-platform-domain-map.md`](specs/decisions/0002-developer-platform-domain-map.md) for the prior layout, what was retired, and why.

| Platform | Domain | Spec home |
|----------|--------|-----------|
| **Spine** | identity | [`specs/domains/identity/`](specs/domains/identity/) |
| **Spine** | authorization | [`specs/domains/authorization/`](specs/domains/authorization/) |
| **Spine** | tenancy | [`specs/domains/tenancy/`](specs/domains/tenancy/) |
| **Spine** | organization | [`specs/domains/organization/`](specs/domains/organization/) |
| **Spine** | audit | [`specs/domains/audit/`](specs/domains/audit/) |
| **Spine** | observability | [`specs/domains/observability/`](specs/domains/observability/) |
| **Spine** | search | [`specs/domains/search/`](specs/domains/search/) |
| **Compute** | cluster | [`specs/domains/compute/cluster/`](specs/domains/compute/cluster/) |
| **Compute** | runtime | [`specs/domains/compute/runtime/`](specs/domains/compute/runtime/) *(stub, to be created)* |
| **Compute** | image-build | [`specs/domains/compute/image-build/`](specs/domains/compute/image-build/) *(stub, to be created)* |
| **Compute** | ingress | [`specs/domains/compute/ingress/`](specs/domains/compute/ingress/) *(stub, to be created)* |
| **Compute** | dns | [`specs/domains/compute/dns/`](specs/domains/compute/dns/) *(stub, to be created)* |
| **Storage** | object-storage | [`specs/domains/storage/object-storage/`](specs/domains/storage/object-storage/) *(stub, to be created)* |
| **Storage** | block-storage | [`specs/domains/storage/block-storage/`](specs/domains/storage/block-storage/) *(stub, to be created)* |
| **Storage** | secrets | [`specs/domains/storage/secrets/`](specs/domains/storage/secrets/) *(stub, to be created)* |
| **Code** | repository | [`specs/domains/code/repository/`](specs/domains/code/repository/) *(stub, to be created)* |
| **Code** | pipeline | [`specs/domains/code/pipeline/`](specs/domains/code/pipeline/) *(stub, to be created)* |
| **Code** | artifact-registry | [`specs/domains/code/artifact-registry/`](specs/domains/code/artifact-registry/) *(stub, to be created)* |
| **Workflow** | triggers | [`specs/domains/workflow/triggers/`](specs/domains/workflow/triggers/) *(stub, to be created)* |
| **Workflow** | scheduling | [`specs/domains/scheduling/`](specs/domains/scheduling/) |
| **Workflow** | jobs | [`specs/domains/workflow/jobs/`](specs/domains/workflow/jobs/) *(stub, to be created)* |
| **Workflow** | function-runner | [`specs/domains/workflow/function-runner/`](specs/domains/workflow/function-runner/) *(stub, to be created)* |
| **Workflow** | approvals | [`specs/domains/approvals/`](specs/domains/approvals/) |
| **Workflow** | import-export | [`specs/domains/import-export/`](specs/domains/import-export/) |
| **Commerce** | billing | [`specs/domains/billing/`](specs/domains/billing/) |
| **Commerce** | quotas | [`specs/domains/quotas/`](specs/domains/quotas/) |
| **Commerce** | metering | [`specs/domains/commerce/metering/`](specs/domains/commerce/metering/) *(stub, to be created)* |
| **Commerce** | plans | [`specs/domains/commerce/plans/`](specs/domains/commerce/plans/) *(stub, to be created)* |
| **First-party apps** *(parked)* | cms | `apps/cms/` once moved (currently `modules/content-pages/`, `modules/catalog/`, `apps/authoring/`, `packages/page-templates/`, `packages/bundles/standard/`) |

The Compute / Storage / Code platforms and the new Workflow domains are **net-new and currently unspecified** — capability specs land in subsequent PRs per the slice workflow. Phase 1 of the project plan starts with `compute/cluster` (stand up k3s on Hetzner) and `compute/image-build` (kaniko in-cluster).

Domain stub directories under `specs/domains/` are created lazily as their first capability is scoped — no need to land empty `README.md` placeholders ahead of work.

The directory layout under `specs/domains/` will reorganise as new domains land — Compute / Storage / Code domains nest under their platform dir (e.g. `specs/domains/compute/cluster/`) for clarity, since they're newly carved.

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
| atlasctl (operator CLI) | `pnpm atlasctl <command> [flags]` |
| Typecheck | `pnpm typecheck` |
| Unit tests | `pnpm test` |
| E2E (Playwright) | `pnpm test:e2e` |
| BDD (Playwright + Gherkin) | `pnpm bdd` |
| Lint | `pnpm lint` |
| DB up (Postgres) | `make db-up` |

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

These rules are non-negotiable. They show up in nearly every code review:

- **`AtlasElement` is the only base class for UI elements.** Bare `HTMLElement`, framework components (Lit/React/Vue), or wrapper classes are not allowed in Atlas frontend code. New components belong in [`packages/design/`](packages/design/CLAUDE.md).
- **`apps/server` is the only HTTP boundary.** Every other app (admin, authoring, sandbox) is a *client* of it. No other package or app may expose HTTP endpoints (Invariant **I1**). The full request flow is traced in [`specs/lifecycle.md`](specs/lifecycle.md).
- **Modules under `/modules` may not import each other directly.** Cross-domain reads use events/projections (Invariant **I12**). The escape hatch for unavoidable sync access is `modules/<x>/src/public/` — anything outside that path is forbidden by `pnpm deps:check`. Run `pnpm deps:graph` to render the current dependency graph as `deps.html`.

## Gotchas

- **Podman, not Docker.** Container runtime defaults to Podman. `CONTAINER_RUNTIME=docker` to override.
- **Module IDs are kebab-case.** Workspace names use `@atlas/<name>`; module dirs match.
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
