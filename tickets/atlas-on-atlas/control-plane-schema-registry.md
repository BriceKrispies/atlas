---
title: Control-plane-backed schema/manifest registry — hot schema registration (no restart)
status: scoped
type: capability
owner: spec-keeper
phase: 0
capability: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md
adr: specs/decisions/0014-self-evolving-substrate.md
vision: [atlas-on-atlas, machine-readable-surfaces]
invariants: [I20, I19, I17]
blocks: []
blocked_by: []
files_in_scope:
  - packages/schemas/src/loader.ts
  - adapters/node/src/control-plane-registry.ts
  - adapters/idb/src/control-plane-registry.ts
  - adapters/node/src/migrations/control-plane/**
  - ports/src/control-plane-registry.ts
  - apps/server/test/always-on/**
acceptance:
  - "A control-plane table stores intent schemas + module manifests as data (new migration under adapters/node/src/migrations/control-plane/). The bundled `@atlas/schemas` set seeds it on first boot; it is not the live source of truth."
  - "PostgresControlPlaneRegistry.getSchemaValidator / getAction read from the control-plane pool (the pool already held but unused per control-plane-registry.ts:10-12), not from the compile-time `moduleManifests()` + cached ajv. The reserved-pool comment is removed because the pool is now consulted."
  - "packages/schemas/src/loader.ts no longer permanently memoizes a single static ajv (cachedAjv); a schema registered at runtime is resolvable by getSchemaValidator without rebuilding the package or restarting the process."
  - "Hot-registration test (same process, no restart): submit an intent whose schemaId is unregistered → 400 UNKNOWN_SCHEMA; write the schema row to the control plane; submit again → no longer UNKNOWN_SCHEMA. apps/server bootId is identical across both submits (I20)."
  - "idb parity: InMemoryControlPlaneRegistry (adapter-idb) mirrors dynamic registration so the sim and contract-tests agree."
  - "pnpm typecheck + pnpm test + pnpm deps:check green; the always-on gate (apps/server/test/always-on/) gains a case asserting a schema addition is a platform-data change requiring no restart."
created: 2026-05-23
updated: 2026-05-23
---

> **2026-05-23 update:** `blocked_by: atlas-on-atlas/stage-8` was DROPPED during
> Phase-0 scoping (verdict: UNBLOCK — see capability README "Blocked-By
> Reconciliation"). Stage-8 depends on the unbuilt `packages/kernel`; this
> capability lands at the *existing* `PostgresControlPlaneRegistry` +
> `InMemoryControlPlaneRegistry` seam (whose control-plane pool is already wired
> but unused) and is independent of the kernel module-registry. Coupling, if
> any, runs the other way (stage-8's eventual "migrate the manifest source" step
> could read from this registry). I17 added to invariants (action registry is
> the I17 parity source). `acceptance:` below is retained verbatim; the README
> refines it into named tests.

## Why

Adding an intent schema is, conceptually, a **data** change (a JSON document), but today it is a **kernel** change. `packages/schemas/src/loader.ts` builds a single cached ajv (`cachedAjv`) from a hardcoded array of static `import … with { type: 'json' }` statements; `getSchemaValidator` only ever consults that bundled set. `PostgresControlPlaneRegistry.getSchemaValidator` (control-plane-registry.ts:111) just delegates to it, and the action catalog is built from statically-bundled `moduleManifests()`. So registering a new schema requires regenerating `generated/`, recompiling `@atlas/schemas`, and **restarting the server** — a kernel touch under I20 (would trip an always-on §11 Kernel Touch Retrospective).

This violates the "could this be data?" rule (`specs/crosscut/kernel-vs-data.md`) and the always-on contract (§6) the platform is built on. The control-plane registry already concedes the gap in its own header: *"The control-plane pool is held for future use (live schema lookups, tenant-module enablement) but is unused by the three port methods today."* This ticket lands that future.

**Motivating finding (2026-05-23):** real email+password login is blocked because no `identity.*` intent schemas are registered (`Identity.Login.Password` → `400 UNKNOWN_SCHEMA` at `packages/ingress/src/submit-intent.ts:150`). The `Identity.Login.Password` *handler* is already compiled in (`modules/identity/src/handlers/registry.ts:676`) — nothing about behavior changes; only a declaration is missing. That makes it the cleanest possible "should be data" case: once schema registration is control-plane-backed, unblocking password login (and every future schema add) is a pure data write, zero recompile, zero restart.

`stage-8-manifests-and-drift-probe` explicitly defers this ("Migrating away from the static `moduleManifests()` array entirely … a stage-9+ follow-up", "manifests stay statically bundled via loader.ts for v1"). This is that follow-up.

## Scope

**In:**

1. **Control-plane storage.** A migration adds a table holding intent-schema documents (and, optionally, manifests) keyed by `schemaId` + `schemaVersion`. On first boot, the bundled `@atlas/schemas` set seeds it (idempotent), so existing behavior is preserved; thereafter the table is the source of truth.
2. **Dynamic registry.** `PostgresControlPlaneRegistry` consults the control-plane pool for `getSchemaValidator` / `getAction` / `hasAction`. ajv validators are compiled on demand and cached per `(schemaId, version)` with invalidation when a row changes (mirror the per-process TTL/event pattern used by `TenantHostCache` if a cache is needed).
3. **idb parity.** `InMemoryControlPlaneRegistry` gains the same dynamic-registration semantics so node↔idb parity and the contract suite hold.
4. **I20 proof.** An always-on test asserts that registering a schema and validating an intent against it happens within one process lifetime (stable bootId).

**Out:**

- Authoring the identity manifest / schemas themselves — that's the data write this enables (file as a thin follow-up, or note it can be done via the new data path once this lands).
- The quick stop-gap (statically bundle `identity.*` schemas + restart). If password login is needed before this ships, that's a separate `chore/` ticket that accepts the restart + retro.
- Per-tenant schema overrides / tenant-defined entity schemas (that's the Extensibility custom-schema substrate, ADR 0005 — distinct from platform intent schemas).
- An operator HTTP surface for registering schemas (atlas-on-atlas/stage-9 territory).

## Resume prompt

```
Make the platform intent-schema + manifest registry control-plane-data-backed
so schema registration is a hot, no-restart data change (I20). Driving ADRs:
0014 (self-evolving substrate) + 0008 (atlas-on-atlas). Blocked on
atlas-on-atlas/stage-8 (manifests exist as data shape + AJV-on-register).

Read first:
- packages/schemas/src/loader.ts — the static SCHEMAS array + cached ajv
  (getAjv memoizes cachedAjv); getSchemaValidator only reads it.
- adapters/node/src/control-plane-registry.ts — note lines 10-12 (the
  reserved-but-unused control-plane pool) and getSchemaValidator (line 111,
  pure delegation today).
- packages/ingress/src/submit-intent.ts:149-152 — the UNKNOWN_SCHEMA gate
  this unblocks.
- specs/crosscut/kernel-vs-data.md ("could this be data?") + always-on.md §6.

Design + implement (spec-first — Phase 0 capability README before code):
1. control-plane migration: table of schema docs keyed (schemaId, version).
   Seed from the bundled @atlas/schemas set on boot, idempotently.
2. PostgresControlPlaneRegistry reads from the control-plane pool; compile
   ajv validators on demand, cache per (schemaId, version), invalidate on
   row change.
3. InMemoryControlPlaneRegistry (adapter-idb) mirrors dynamic registration.
4. always-on test: submit unregistered intent → 400 UNKNOWN_SCHEMA; write
   schema row; submit again → not UNKNOWN_SCHEMA; bootId stable across both.

Gate: pnpm typecheck + pnpm test + pnpm deps:check green; contract suite
runs against both node and idb; always-on no-restart case green.
```

## Notes / log

- 2026-05-23: created from a chat finding while standing up the local smoke test. Real password login is blocked by missing `identity.*` intent schemas, and registering them is currently a recompile+restart (kernel touch) rather than a data write. This ticket generalizes the fix to "schema/manifest registration is control-plane data," which is what always-on §6 / ADR 0014 / the reserved control-plane pool already point at. Related: `chore/sync-schemas-coverage-decision` (single-source-of-truth for hand-maintained schema duplicates) and `atlas-on-atlas/stage-8-manifests-and-drift-probe` (manifests as AJV-validated data, still statically bundled — this is its explicit "migrate the source" follow-up).
- 2026-05-23: **Phase 0 scoped** by spec-keeper. Capability README written at `specs/domains/runtime/capabilities/control-plane-schema-registry/README.md` (new Spine-adjacent `runtime` domain — platform runtime substrate; placement justified + flagged for platform-owner review in the README). All six ticket findings verified against source: (1) `loader.ts` `cachedAjv` static-memoized — confirmed; (2) `submit-intent.ts:149-152` `UNKNOWN_SCHEMA` + `:187` `getAction` — confirmed; (3) NO identity manifest and NO `identity.*` schemas exist (only authz/catalog/content_pages/dsl/repository/seed) — confirmed; (4) pool held-but-unused at `control-plane-registry.ts:10-12,59-63` (`void this.controlPlane`), wired at `bootstrap.ts:363` — confirmed; (5) `state.registry` single `PostgresControlPlaneRegistry` at `state.ts:534`, narrow port — confirmed; (6) `Identity.Login.Password` handler wired at `registry.ts:676` — confirmed. `packages/kernel` confirmed absent (stage-6 unbuilt) → `blocked_by` dropped. Storage shape: `control_plane.intent_schemas` (PK schemaId,version) + `control_plane.action_entries` (PK actionId) + a `registry_version` change-cursor; seed-from-bundle idempotent on boot. Status → scoped; awaiting user spec-approval checkpoint before Phase 1.0. Highest open risk flagged for spine-owner/architect: O1 sync-vs-async port surface (recommended: keep sync via boot snapshot + cursor refresh).
- 2026-05-24: **frontmatter is STALE — Phase 1 appears already built.** Board-recon found `adapters/node/src/control-plane-registry.ts` is now a full `PostgresControlPlaneRegistry` reading the control-plane pool (intent_schemas/action_entries) with exactly the O1 sync-over-async design flagged above: process-local snapshot + `apps/server/src/middleware/registry-refresh.ts` request-boundary `refresh()` (N+1 visibility, stable bootId/I20), `registry_version` cursor driving compiled-validator invalidation. `@spec` links back to the capability README. This is the implementation the ticket scopes — not the "pool held but unused" state the `## Why` still describes. Status frontmatter still `scoped`. ACTION: verify remaining acceptance (idb `InMemoryControlPlaneRegistry` parity; always-on no-restart test; `pnpm deps:check`) and advance status to match reality — do NOT re-dispatch as greenfield.
