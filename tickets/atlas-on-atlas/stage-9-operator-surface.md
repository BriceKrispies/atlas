---
title: Atlas-on-Atlas Stage 9 — atlasctl kernel commands + audit events + I17 parity
status: scoped
type: capability
owner: module-dev
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, agentic-first]
invariants: [I17, I19]
blocks: []
blocked_by:
  - atlas-on-atlas/stage-7-kernel-migration
  - atlas-on-atlas/stage-8-manifests-and-drift-probe
files_in_scope:
  - apps/server/src/routes/kernel.ts
  - apps/server/src/main.ts
  - apps/atlasctl/src/commands/kernel/modules.ts
  - apps/atlasctl/src/commands/kernel/snapshot.ts
  - apps/atlasctl/src/commands/kernel/reload.ts
  - apps/atlasctl/src/commands/kernel/events.ts
  - apps/atlasctl/src/index.ts
  - specs/crosscut/atlasctl.md
  - specs/crosscut/events.md
  - packages/kernel/src/kernel.ts
  - apps/server/test/always-on/f5-operator-surface.test.ts
  - apps/atlasctl/test/parity.test.ts
acceptance:
  - "apps/server/src/routes/kernel.ts (NEW): four routes — GET /api/v1/kernel/modules (list registered modules), GET /api/v1/kernel/snapshot (full KernelSnapshot), POST /api/v1/kernel/modules/:id/reload (re-register a module's handlers; in v1 the body is a manifest), SSE GET /api/v1/kernel/events (stream Audit.Kernel.* events). All routes gated by operator authz: the principal MUST have tenantId === PLATFORM_TENANT_ID."
  - "apps/server/src/main.ts wires kernel routes into the authed group BUT they bypass the catch-all dispatch (kernel routes are introspection, not actions). Mount before the catch-all."
  - "apps/atlasctl/src/commands/kernel/{modules,snapshot,reload,events}.ts (NEW): each is a thin HTTP wrapper over the corresponding route. Output: JSON by default, --format=table available for modules/snapshot. The events command opens an SSE stream and writes one line per audit event to stdout."
  - "apps/atlasctl/src/index.ts wires the four commands under `atlasctl kernel <subcommand>`."
  - "specs/crosscut/atlasctl.md operator CLI section adds the four commands with usage examples."
  - "specs/crosscut/events.md vocabulary adds: Audit.Kernel.ModuleRegistered, Audit.Kernel.ModuleUnregistered, Audit.Kernel.ChainVersionAdvanced, Audit.Kernel.SnapshotRead. Each entry follows the existing template (event name, schemaId, when emitted, payload fields)."
  - "packages/kernel/src/kernel.ts: handlers.register/unregister and modules.register/unregister emit corresponding Audit.Kernel.* events via an AuditEmitter dep (added to Kernel constructor). chains.register emits Audit.Kernel.ChainVersionAdvanced. Each carries correlationId + principalId + result + durationMs."
  - "apps/server/test/always-on/f5-operator-surface.test.ts (NEW): behavioral tests. Setup: spin up a Hono app with the kernel routes + a test principal middleware. Tests: (a) tenant principal gets 403 on GET /modules; (b) operator principal (tenantId=_platform) gets 200 with the registered modules; (c) POST /modules/:id/reload installs a fixture module and the next GET /modules reflects it; (d) SSE /events emits an Audit.Kernel.ModuleRegistered line after a reload."
  - "apps/atlasctl/test/parity.test.ts extended: every kernel command name appears in both the atlasctl command registry AND the HTTP route table. I17 parity enforced mechanically."
  - "pnpm safe typecheck clean."
  - "pnpm safe test passes."
  - "pnpm safe deps:check 0 errors."
  - "pnpm safe bdd passes (no surface regressions; the new routes are admin-only)."
created: 2026-05-10
updated: 2026-05-10
---

## Why

The kernel becomes useful when operators can drive it. Stage 9 lands the operator surface always-on.md §5 specified. With this in place, the always-on contract becomes:

- **Observable**: `atlasctl kernel snapshot` returns the live `KernelSnapshot`.
- **Mutable**: `atlasctl kernel reload <module>` installs a new module version.
- **Audited**: `atlasctl kernel events --follow` streams `Audit.Kernel.*` events.

I17 (API/CLI/UI parity) ensures no asymmetry between operator-human and operator-agent — every kernel command exists as both HTTP and atlasctl. The parity test is mechanical.

Stage 9 closes the always-on §5 commitment. After it, the always-on contract is end-to-end implemented and end-to-end testable.

## Scope

**In:**

1. **HTTP routes** (`apps/server/src/routes/kernel.ts`) — four endpoints, all operator-authz gated.
2. **atlasctl commands** under `kernel` subcommand — thin HTTP wrappers.
3. **Audit emission** from kernel mutations — `Audit.Kernel.*` events through the existing `AuditEmitter` port.
4. **Spec updates** — `crosscut/atlasctl.md` and `crosscut/events.md` document the new surface.
5. **F5 test file** — new behavioral coverage of the operator routes + audit emission.
6. **I17 parity test** — extended to cover the kernel commands.

**Out:**

- Multi-replica reload coordination (always-on §4.6 defers this).
- Rolling-restart fallback prose (lives in spec, not code).
- Surface for the snapshot/reload routes in the admin UI (could land as a follow-up frontend ticket).
- Hot-reload of `packages/kernel/` itself (the kernel package is platform code, not tenant code; meta-reload is out of always-on v1 scope).

## Resume prompt

```
Atlas-on-Atlas Stage 9 — operator surface. Blocked on stage 7 (kernel
wired into apps/server) and stage 8 (manifests + AJV validation). This
is the cap of the kernel rewrite: with stage 9 the always-on contract
end-to-end is implemented AND testable.

Step 1 — Read always-on.md §5 (operator surface), the existing
atlasctl command patterns at apps/atlasctl/src/commands/intents/, and
specs/crosscut/atlasctl.md.

Step 2 — apps/server/src/routes/kernel.ts (NEW).
  Four routes. All gated by an operator-authz middleware that checks
  c.var.principal.tenantId === PLATFORM_TENANT_ID. 403 otherwise.

  GET /api/v1/kernel/modules → JSON array of { moduleId, version, manifest }.
    Reads from state.kernel.modules.list().

  GET /api/v1/kernel/snapshot → JSON of KernelSnapshot.
    Reads state.kernel.snapshot(). Emits Audit.Kernel.SnapshotRead.

  POST /api/v1/kernel/modules/:id/reload
    Body: { manifest: ModuleManifest, instance?: unknown }
    Flow: kernel.modules.unregister(id) (if present) → kernel.modules.register(...).
    Audit.Kernel.ModuleRegistered emitted; if unregistered first,
    also Audit.Kernel.ModuleUnregistered.
    Manifest validation failures return 400 with AJV error details.

  GET /api/v1/kernel/events (SSE) → live stream of Audit.Kernel.* events.
    Uses the existing serverEvents broadcast channel; filters on
    eventType starts-with 'Audit.Kernel.'.

Step 3 — Wire kernel routes into apps/server/src/main.ts.
  Mount inside the authed group, BEFORE the catch-all from stage 7.
  Kernel routes are introspection/control — not action dispatch — so
  they don't go through the catch-all's handler resolution.

Step 4 — atlasctl commands. Create:
  apps/atlasctl/src/commands/kernel/modules.ts
    `atlasctl kernel modules [--format=json|table]`
    GETs /api/v1/kernel/modules, prints output.
  apps/atlasctl/src/commands/kernel/snapshot.ts
    `atlasctl kernel snapshot [--format=json|table]`
    GETs /api/v1/kernel/snapshot, prints output.
  apps/atlasctl/src/commands/kernel/reload.ts
    `atlasctl kernel reload <moduleId> --manifest=path/to/manifest.json`
    Reads the manifest file, POSTs to /api/v1/kernel/modules/:id/reload.
  apps/atlasctl/src/commands/kernel/events.ts
    `atlasctl kernel events [--follow]`
    GETs SSE /api/v1/kernel/events; prints each event as one JSON line.
  Wire all four under `atlasctl kernel <subcommand>` in
  apps/atlasctl/src/index.ts.

Step 5 — Audit emission. Edit packages/kernel/src/kernel.ts:
  Add an AuditEmitter dep to the Kernel constructor:
    constructor(deps: { eventStore: EventStore; audit: AuditEmitter; ... })
  In MutableHandlerRegistry.register/unregister, emit
    Audit.Kernel.ModuleRegistered / Audit.Kernel.ModuleUnregistered
    (or HandlerRegistered/Unregistered if you want finer granularity —
    pin to module-level for v1 since handlers register en masse).
  In VersionedDispatcherChainRegistry.register, emit
    Audit.Kernel.ChainVersionAdvanced.
  In Kernel.snapshot(), emit Audit.Kernel.SnapshotRead.
  Each event carries correlationId (from the caller's
  AtlasExecutionContext), principalId (caller's), result ('success' |
  'failed'), durationMs.

  Schema additions for these events: add to packages/schemas/src/generated/
  (and the corresponding spec file at specs/schemas/contracts/). Use
  the same shape as existing Audit.* events (look at
  specs/schemas/contracts/platform.policy_evaluated.v1.schema.json
  for the template).

Step 6 — Spec updates.
  specs/crosscut/atlasctl.md — add `atlasctl kernel modules`,
    `atlasctl kernel snapshot`, `atlasctl kernel reload`,
    `atlasctl kernel events` to the command reference table.
  specs/crosscut/events.md — add the four Audit.Kernel.* event types.

Step 7 — apps/server/test/always-on/f5-operator-surface.test.ts (NEW).
  Reuse the fake-state harness pattern from intents.test.ts.
  Tests:
    a. GET /api/v1/kernel/modules with a tenant principal returns 403.
    b. GET /api/v1/kernel/modules with operator principal
       (tenantId=PLATFORM_TENANT_ID) returns 200 with the registered
       modules (use buildTestKernel + register two fixture modules).
    c. POST /api/v1/kernel/modules/test-module/reload with a valid
       manifest registers; next GET /modules includes it.
    d. POST .../reload with an invalid manifest (missing required
       cacheInvalidationTags) returns 400 with AJV errors.
    e. SSE /api/v1/kernel/events: open the stream, trigger a reload,
       receive an Audit.Kernel.ModuleRegistered line.

Step 8 — Extend apps/atlasctl/test/parity.test.ts.
  The existing parity test enumerates atlasctl commands and HTTP routes;
  add an assertion that every command under `atlasctl kernel ...` has
  a corresponding /api/v1/kernel/... route. Today's mechanism: read
  the atlasctl command registry + crawl the Hono routes (or
  introspect from the route file).

Done bar:
- pnpm safe typecheck clean
- pnpm safe test passes (F5 green, parity green)
- pnpm safe deps:check 0 errors
- pnpm safe bdd passes
- specs/crosscut/atlasctl.md and specs/crosscut/events.md both
  reference the new surface

Update tickets/atlas-on-atlas/stage-9-operator-surface.md log on
completion. Set status: review and hand to sdet, then architect.
After architect signs off: this closes the Atlas-on-Atlas kernel
rewrite. Set status: done, archive.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Closes the always-on contract end-to-end. Smallest of the kernel-rewrite tickets in terms of LOC but highest visibility — this is what operators (and agents) actually call. I17 parity is the mechanical guard that ensures no asymmetry creeps in.
