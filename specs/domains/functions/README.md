# Functions
**Platform:** Extensibility
**Status:** Stub — domain shape committed, content TBD.

## Purpose
Sandboxed tenant-authored code. Lets a tenant attach behavior to schema events,
expose HTTP endpoints, or run scheduled jobs without operating their own
runtime. The "Apex" of Atlas.

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
