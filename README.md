# Atlas Platform

Multi-tenant CMS + workflow platform built on hexagonal architecture
(ports/adapters), CQRS, and event-sourced projections. TypeScript
end-to-end (Node + browser).

## Documentation

**All platform documentation lives in `/specs`** — specs are the source
of truth, code is secondary.

- [`CLAUDE.md`](CLAUDE.md) — top-level agent routing (which doc to read for which task)
- [`specs/architecture.md`](specs/architecture.md) — Principles P1-P6, Invariants I1-I12
- [`specs/lifecycle.md`](specs/lifecycle.md) — request flow, end-to-end
- [`SYSTEM_MAP.md`](SYSTEM_MAP.md) — deep map of where things live
- [`PROGRESS.md`](PROGRESS.md) — what's implemented vs planned
- [`PORTS.md`](PORTS.md) — dev port assignments

Browse the rendered specs:

```bash
cd specs && mdbook serve   # http://localhost:3000
```

## Workspace Structure

```
adapters/       Port implementations
  idb/          Browser IndexedDB
  node-postgres/ Server Postgres
  policy-cedar/ Cedar policy engine
  policy-stub/  Allow-all stub for tests
apps/           Runnable units
  server/       Hono HTTP ingress (the only HTTP boundary, I1)
  admin/        Admin shell
  authoring/    Authoring shell
  sandbox/      Component sandbox
  projection-worker/  Async projection worker
modules/        Pure domain logic — handlers, projections, queries
  authz/
  catalog/
  content-pages/
  identity/
packages/       Shared infra
  core/         AtlasElement, signals, html template
  design/       Component library
  ingress/      submitIntent pipeline (the I1 chokepoint logic)
  platform-core/  EventEnvelope, IntentEnvelope, common types
  schemas/      Zod schemas + JSON Schema contracts
ports/          @atlas/ports — port interfaces
specs/          RFC-style specs (source of truth)
tests/
  bdd/          Playwright + Gherkin
infra/compose/  Postgres + dev stack
```

## Quick Start

```bash
pnpm install

# Start Postgres on host port 15433 (Podman)
make db-up

# Server (Hono, :3000)
pnpm --filter @atlas/server dev

# Admin shell (Vite, :5173)
pnpm dev

# Authoring shell (Vite, :5181)
pnpm authoring

# Sandbox (Vite, :5180)
pnpm sandbox
```

## Tests

```bash
pnpm typecheck
pnpm test            # unit
pnpm bdd             # Playwright + Gherkin
pnpm test:e2e        # Playwright e2e
make spec-check      # spec/fixture validation
```

## Database

Default URL:

```
CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/control_plane
```

Host port `15433` is intentional — picked outside the standard
5432/5433 range to avoid colliding with native Postgres on dev
machines. See [`PORTS.md`](PORTS.md).

```bash
make db-up      # start
make db-status  # health
make db-logs
make db-down
make db-reset   # destructive — drop + re-migrate
```

Container runtime defaults to **Podman**. Set
`CONTAINER_RUNTIME=docker` to override.

## Core Invariants

I1-I12 are non-negotiable. Full definitions in
[`specs/architecture.md`](specs/architecture.md).

| | |
|---|---|
| I1 | Single ingress chokepoint |
| I2 | Authorization before execution |
| I3 | Idempotency before dispatch |
| I4 | Deny-overrides-allow |
| I5 | Correlation propagation |
| I6 | Causation linkage |
| I7 | Tenant isolation in search |
| I8 | Permission-filtered search |
| I9 | Cache keys include `tenantId` |
| I10 | Event-driven cache invalidation |
| I11 | Deterministic time bucketing (analytics) |
| I12 | Projections rebuildable from events |

## License

Proprietary.
