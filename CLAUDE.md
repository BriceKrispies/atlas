# Atlas Platform

Multi-tenant CMS + workflow platform. Rust backend (hexagonal architecture, CQRS, event sourcing, ABAC authorization). Vanilla JS frontend (custom web components, no framework). Spec-first development — `specs/` is the source of truth; 8 feature modules are spec-only with no domain code yet.

## Quick Commands

| Task | Command |
|------|---------|
| Build all | `make build` |
| Test all | `make test` |
| Format | `make fmt` |
| Lint | `make lint` |
| Run ingress (in-memory) | `make run-ingress` |
| Spec validation | `make spec-check` |
| DB up (Postgres) | `make db-up` |
| DB migrate | `make db-migrate` |
| DB seed | `make db-seed` |
| DB reset | `make db-reset` |
| Frontend dev | `cd frontend && pnpm dev` |
| Frontend E2E | `cd frontend && pnpm test:e2e` |
| Integration tests | `make itest` (starts full stack + runs tests) |
| Integration tests only | `make itest-test` (stack must be running) |

## Agent Routing — Where to Go

| Your task involves... | Read this |
|-----------------------|-----------|
| Backend Rust crate work | `crates/CLAUDE.md` |
| Ingress HTTP layer (endpoints, auth, middleware) | `crates/ingress/CLAUDE.md` |
| Frontend / web components / UI surfaces | `frontend/CLAUDE.md` |
| Reading or writing specifications | `specs/CLAUDE.md` |
| Integration / black-box tests | `tests/blackbox/CLAUDE.md` |
| Infrastructure / containers / compose | `infra/CLAUDE.md` |
| Control plane (Go) | `apps/control-plane/` — small service, no sub-router |
| WASM plugins | `plugins/` + see wasm_runtime in `crates/CLAUDE.md` |
| CLI tooling | `tools/cli/` (dev), `crates/atlasctl/` (operator CLI) |
| Deep system exploration | `SYSTEM_MAP.md` — detailed AI-oriented reference |

## Non-Negotiable Invariants

These are architectural laws. Violating them is a bug. Full definitions: `specs/architecture.md`.

- **I1**: All requests go through the single ingress chokepoint — no other crate exposes HTTP
- **I2**: Authorization runs BEFORE execution — no side effects on denied requests
- **I3**: Idempotency checked before handler dispatch
- **I4**: Deny-overrides-allow in policy evaluation
- **I5**: correlationId propagates through the entire request flow
- **I7**: Tenant isolation in search — tenantId always in scope
- **I9**: Cache keys MUST include tenantId (unless explicitly PUBLIC)
- **I10**: Cache invalidation is event-driven via tag-based purging, not TTL
- **I12**: Projections must be rebuildable from event history alone

## Gotchas

- **Podman, not Docker.** Container runtime defaults to Podman. Set `CONTAINER_RUNTIME=docker` to override.
- **Windows link error.** If `ingress.exe` is running, `cargo build` fails with "access denied" on the link step. Kill the process first, or use `cargo check`.
- **ATLAS_ENV.** Defaults to `strict` (production-like). Set `ATLAS_ENV=dev` for dev defaults. `TENANT_ID` env var is forbidden in strict mode.
- **test-auth feature.** `cargo build -p atlas-platform-ingress --features test-auth` enables `X-Debug-Principal` header. Never in production.
- **Modules are spec-only.** The 8 feature modules (tokens, comms, org, content, points, audit, import, badges) have specs but NO Rust domain code yet.
- **DB connection.** `CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:5433/control_plane`

## Key Reference Files

| File | What it contains |
|------|-----------------|
| `specs/architecture.md` | Principles P1-P6, Invariants I1-I12, full system design |
| `specs/LEXICON.md` | Canonical vocabulary — nouns, verbs, pipelines |
| `specs/normative_requirements.md` | RFC 2119 compliance rules for the compiler |
| `SYSTEM_MAP.md` | Deep AI-agent exploration guide with request traces |
| `PROGRESS.md` | What's implemented vs. stubbed vs. missing |
| `FEATURES.md` | High-level feature list across all modules |
