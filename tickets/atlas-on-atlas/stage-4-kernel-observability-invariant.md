---
title: Atlas-on-Atlas Stage 4 — add I19 (Kernel State Machine-Readability) + always-on §10 testability amendment
status: scoped
type: spec
owner: spec-keeper
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [agentic-first, machine-readable-surfaces, atlas-on-atlas]
invariants: [I18, I19]
blocks:
  - atlas-on-atlas/stage-5-kernel-ports
  - atlas-on-atlas/stage-6-kernel-package
  - atlas-on-atlas/stage-7-kernel-migration
  - atlas-on-atlas/stage-8-manifests-and-drift-probe
  - atlas-on-atlas/stage-9-operator-surface
blocked_by: []
files_in_scope:
  - specs/architecture.md
  - specs/crosscut/always-on.md
  - specs/decisions/0008-atlas-on-atlas.md
  - specs/CLAUDE.md
acceptance:
  - "I19 (Kernel State Machine-Readability) added to specs/architecture.md immediately after I18 with the full Invariant / Semantics / Purpose / Violation / Source block, modeled on I18's shape"
  - "specs/crosscut/always-on.md gains a §11 Testability (or a §10 subsection) naming I19 as the normative anchor for: getKernelSnapshot() introspection, HandlerRegistry mutation (register/unregister/snapshot), DispatcherChainRegistry versioning, and EventStore append-time chain-version stamping"
  - "specs/CLAUDE.md crosscut listing references the §11 amendment; agent-routing rows that touch the kernel reference I19 alongside I18"
  - "specs/decisions/0008-atlas-on-atlas.md Stage 6 entry updated to cite I19 as the spec-level outcome of always-on.md"
  - "grep -rE '\\bI19\\b' specs/ returns hits in architecture.md, crosscut/always-on.md, CLAUDE.md, and decisions/0008-atlas-on-atlas.md"
  - "pnpm safe typecheck clean (spec-only change; sanity)"
created: 2026-05-10
updated: 2026-05-10
---

## Why

Three rounds of SDET adversarial review on `apps/server/test/always-on/` converged on the same finding: the always-on contract names seams that don't exist as first-class artifacts. The kernel is implicit — distributed across `bootstrap.ts`, `state.ts:buildRequestBundle`, static module imports, and Hono route closures — so behavioral tests have to use proxies (source-text scans, schema introspection) instead of real surfaces.

**I18** makes UI surfaces machine-readable. There is no equivalent for the runtime kernel. That asymmetry is the architectural defect this ticket closes at the spec level. Without I19, stages 5–9 (kernel rewrite) have no normative contract to enforce — the architect's invariant gate has nothing to check the new kernel against.

This is the spec-first hard gate of the Slice Workflow. Stages 5–9 are blocked on it.

## Scope

**In:**

1. **Author I19** in `specs/architecture.md` directly after the I18 block. Use I18 as the structural model. The invariant text MUST require:
   - The kernel exposes `getKernelSnapshot()` returning `{ modules, handlers, chainVersion, dispatcherSummary }`.
   - `HandlerRegistry` exposes typed mutation: `register(actionId, handler)`, `unregister(actionId)`, `snapshot(): {actionId, handlerIdentity}[]`. Handler resolution is at dispatch time, not at app-build time.
   - A `DispatcherChainRegistry` exposes the active chain version and snapshotAt(version). Event-append stamps `dispatcherChainVersion` from this registry.
   - A `ModuleRegistry` exposes registered modules and validates manifests against `module_manifest.schema.json` on register.
   - All mutation/snapshot surfaces are authz-gated against the `_platform` tenant (operator scope).

2. **Amend `specs/crosscut/always-on.md`** with a new §11 Testability (or a §10 subsection — author's choice based on what reads better). The amendment MUST:
   - Reference I19 as the normative anchor for §4.1 (HotReloadable), §4.2 (request-boundary atomicity), §4.3 (invariant preservation across reload), and §5 (operator surface).
   - Spell out the testability contract: every always-on conformance test described in §10 has a corresponding real surface (typed port, snapshot method, mutation API). No source-text proxies.
   - Cross-link to architecture.md§I19.

3. **Update `specs/CLAUDE.md`** to reference I19. Update the architect agent-routing row (currently "I1-I18") to "I1-I19". The crosscut listing for `crosscut/always-on.md` already exists; extend its one-line description to mention testability.

4. **Update `specs/decisions/0008-atlas-on-atlas.md`** Stage 6 entry to cite I19 as the spec-level outcome of `crosscut/always-on.md` (previously the Stage 6 entry just said "drafted").

**Out:**

- Any code changes. This is a pure spec ticket.
- Authoring the port definitions or kernel package (stage 5 + stage 6 own those, blocked on this).
- Updating the architect agent's review checklist file (the agent reads architecture.md directly; the invariant landing there is sufficient).

## Resume prompt

```
Atlas-on-Atlas Stage 4 — author I19 (Kernel State Machine-Readability)
and amend always-on.md with a testability section. Driving ADR:
specs/decisions/0008-atlas-on-atlas.md (this ticket is the spec-level
outcome of Stage 6 that always-on.md left under-specified).

Context — this ticket exists because three rounds of SDET review on
apps/server/test/always-on/ found that the always-on contract has no
normative kernel-observability anchor. I18 made UI surfaces
machine-readable; the runtime kernel needs the equivalent. The relevant
prior conversation produced specs/crosscut/always-on.md; the
SDET-identified gap was that the kernel is not a first-class artifact,
so tests rely on source-text proxies.

Step 1 — Read specs/architecture.md, specifically the I18 block (line ~373).
Use it as the structural model for I19 (Invariant / Semantics / Purpose /
Violation / Source).

Step 2 — Author I19 (Kernel State Machine-Readability). It MUST require:
  - Kernel exposes getKernelSnapshot() returning
    { modules, handlers, chainVersion, dispatcherSummary }.
  - HandlerRegistry has typed mutation: register(actionId, handler),
    unregister(actionId), snapshot(). Resolution is at dispatch time.
  - DispatcherChainRegistry exposes current() chain version and
    snapshotAt(version); event-append stamps envelope.dispatcherChainVersion
    from this registry.
  - ModuleRegistry exposes registered modules; manifests AJV-validated on
    register() against module_manifest.schema.json.
  - Mutation/snapshot surfaces are operator-authz-gated against the
    _platform tenant.
  - Source line: this ticket + specs/crosscut/always-on.md §11.

Step 3 — Amend specs/crosscut/always-on.md. Add §11 Testability (or a
§10 subsection — pick what reads better). Reference I19. Spell out that
every conformance test described in §10 has a real port-typed surface.
Cross-link architecture.md§I19. Length: tight; this is a normative
appendix, not new prose.

Step 4 — Update specs/CLAUDE.md. Change the architect agent-routing row
from "I1–I18" to "I1–I19" (or however the range is currently expressed).
Extend the crosscut/always-on.md listing description to mention
testability.

Step 5 — Update specs/decisions/0008-atlas-on-atlas.md Stage 6 line
(currently at line ~99) to cite I19 as the spec-level outcome.

Step 6 — architect-style read-only sanity (within this spec-keeper agent,
no separate dispatch): re-read the I19 text and the §11 amendment. Verify
they don't contradict any existing invariant or principle. Verify the
references in CLAUDE.md and the ADR are consistent.

Done bar:
- grep -rE '\bI19\b' specs/ returns hits in architecture.md,
  crosscut/always-on.md, CLAUDE.md, decisions/0008-atlas-on-atlas.md
- pnpm safe typecheck clean (spec-only; sanity check)
- The four files in files_in_scope are the only files touched

Update tickets/atlas-on-atlas/stage-4-kernel-observability-invariant.md
log on completion. Set status: done; archive the ticket
(see tickets/CLAUDE.md §Archival).
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Spec-first hard gate for stages 5–9 of the Atlas-on-Atlas kernel rewrite. Drives from three SDET rounds on `apps/server/test/always-on/` that found the always-on contract lacks a normative kernel-observability anchor (I18's runtime counterpart). Stage 6 of ADR 0008 produced `specs/crosscut/always-on.md`; this ticket lifts its testability requirements into the invariant set.
