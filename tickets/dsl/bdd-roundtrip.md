---
title: BDD — full Dsl.Expression.Update → save → list round-trip
status: open
type: test
owner: sdet
phase: 2
adr: specs/decisions/0007-dsl-substrate-and-authoring-contract.md
vision: []
invariants: [I2, I3, I5, I9, I10, I12]
blocks: []
blocked_by: []
files_in_scope:
  - tests/bdd/features/dsl/expression-roundtrip.feature
  - tests/bdd/steps/dsl/*.ts
  - apps/sim/src/main.ts  # ensure dsl handler registry is wired in sim too
acceptance:
  - .feature file describing the full round-trip (parse-error iteration → save → versioned save → list shows latest → history retains v1)
  - Step definitions read surface state via window.__atlasTest (no DOM scraping)
  - Scenario runs green via `pnpm bdd`
  - Asserts cacheInvalidationTags carry both `Tenant:<id>` + `DslArtifact:<id>` (I10)
  - Asserts the dispatch is rebuildable from the synthetic event stream (I12)
  - Asserts correlationId propagates through validate → save → list (I5)
created: 2026-05-21
updated: 2026-05-21
---

## Why

The DSL save path is verified by `curl` smoke-tests against the live
server today, but no BDD scenario exists. The slice workflow gates
merges on `pnpm bdd` for surfaces; the DSL is now a surface (the
authoring endpoints + the read endpoints) and needs scenario coverage
so future drift gets caught at PR time, not next quarter.

The scenario also exercises the I12 worker-mirror invariant: events
emitted by the handler must be replay-able through the dispatcher
chain. The DSL's storage IS the projection per ADR 0007 §3, so this
is the first capability where the dispatcher chain is a no-op on the
read side — useful adversarial check for the substrate.

## Scope

Author a single .feature describing the agent iteration loop and the
save round-trip. Step definitions live under `tests/bdd/steps/dsl/`.

In scope:

- Feature file: tests/bdd/features/dsl/expression-roundtrip.feature
  with three scenarios:
  1. Agent iterates against validate — submits broken source, gets
     DSL_PARSE_ERROR with sourceRange, fixes it, gets ok:true.
  2. Author saves an expression artifact — submits Dsl.Expression.Update,
     gets 200 + eventId, lists artifacts and sees it at version 1.
  3. Author versions an existing artifact — submits a second update,
     lists shows version 2, GET /v/1 still serves the original source.
- Step definitions: use the existing apps/sim harness + window.__atlasTest
  surfaces. The sim already wires the IDB adapter; this ticket extends
  apps/sim/src/main.ts to also register the DSL handler registry (the
  in-memory MemoryDslArtifactStore from modules/dsl/test/memory-store.ts
  can be promoted to the sim, or a new IdbDslArtifactStore lands).
- Each step asserts SHAPE not message text — the message can drift; the
  code + status are the load-bearing surface.
- Cache-tag assertion: read the dispatcher's emitted envelopes from the
  sim's event log and verify `cacheInvalidationTags` carry `Tenant:<id>`
  + `DslArtifact:<id>` per ADR 0007 §5.

Out of scope:

- BDD against the live server. The sim is where BDD lives; live-server
  E2E happens at smoke-test time (curl scripts in the README / dev:up
  output).
- Cedar policy gating. The DSL routes are not policy-checked today
  (slice #5b deferred); the BDD scenario uses test-auth principal.
  Policy gating lands in a separate ticket (dsl/cedar-policy-actions).
- A second .feature for the template or query DSL — separate tickets
  when those land.

## Resume prompt

```
You are sdet. Author BDD coverage for the DSL authoring round-trip.

Read these first:
- tests/bdd/README.md (BDD harness contract — sim-based, window.__atlasTest)
- tests/bdd/features/identity/*.feature (existing scenario shape to mirror)
- apps/server/src/routes/dsl.ts (the four HTTP endpoints)
- modules/dsl/src/handlers/dsl-update.ts (event envelope shape — what
  cacheInvalidationTags must carry)
- adapters/node/src/dsl-artifact-store.ts (the persistence the dispatcher
  contract reads through)
- apps/sim/src/main.ts (where the kind registry needs to land for the
  sim path)

Deliverable: tests/bdd/features/dsl/expression-roundtrip.feature with
the three scenarios in the ticket scope. Step definitions under
tests/bdd/steps/dsl/. apps/sim wiring update so the harness picks up
the dsl handler registry the same way apps/server does.

Adversarial check: this is the first capability whose dispatcher chain
is a no-op on the read side (the artifact store IS the projection per
ADR 0007 §3). Verify the I12 rebuildability assertion still holds — a
synthetic event stream should replay-able into the same store state.
Today's contract test does this via the MemoryStore; the BDD scenario
should exercise the same path against the sim's IDB adapter.
```

## Notes / log

- 2026-05-21: created. Standard sdet hand-off as the slice workflow
  Phase 2 gate. The HTTP surface is verified by smoke-tests today; the
  BDD scenario closes the gap for future drift detection.
