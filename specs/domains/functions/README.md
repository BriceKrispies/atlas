# Functions
**Platform:** Extensibility
**Status:** Active stub — domain shape committed, capability specs land Phase 3–4 of the [vision roadmap](../../vision.md). Revived under Extensibility per [ADR 0003](../../decisions/0003-tenant-defined-data-model-pivot.md) (briefly retired by [ADR 0002](../../decisions/0002-developer-platform-domain-map.md), un-retired same day).

## Purpose
Sandboxed tenant-authored code. Lets a tenant attach behavior to schema events,
expose HTTP endpoints, or run scheduled jobs without operating their own
runtime. The "Apex" of Atlas — third pillar of [`vision.md`](../../vision.md)'s
"the dream" alongside `custom-schema` (data model) and on-demand provisioning
(backend services).

**Distinct from `function-runner`** (under Workflow): `function-runner` is
internal infrastructure for executing workflow jobs; `functions` is the
tenant-facing surface for authoring and attaching code to schema events,
HTTP routes, and schedules. They may share runtime substrate but are
separate domains with separate ports and capabilities.

## Capabilities
TBD. List capabilities here as they're scoped. Capabilities are the agent
ownership unit — one capability ≈ one agent.

## Suggested capabilities (not yet scoped)
- `function-runtime` — sandboxed execution model (isolate strategy: V8 isolates / WASM / process)
- `lifecycle-hooks` — before-save, after-commit, on-delete triggers tied to `custom-schema` objects
- `scheduled-functions` — cron / interval triggers, integrated with the `scheduling` domain
- `http-functions` — tenant-defined HTTP routes, served behind ingress (must respect **I1**)
- `function-logs` — per-tenant execution logs, integrated with `observability` and `quotas`

## Cross-references
- (no legacy mapping — new domain)
- Related invariants: **I1** (http-functions must route through the single ingress chokepoint), **I2** (authz before execution — no side effects on denied requests), **I3** (idempotency before dispatch), **I5** (correlationId propagation)
- Hard dependency on `quotas` for runtime budget enforcement — must not ship without it.
- Hard dependency on `custom-schema` for lifecycle-hook event surface.
