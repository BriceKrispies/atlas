---
title: Seeder Phase 1.3 — packages/seeder runner skeleton
status: review
type: capability
owner: sdet
phase: 2
capability: specs/crosscut/seed-corpus.md
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [agentic-first, atlas-on-atlas]
invariants: [I1]
blocks:
  - seeder/phase-1.5-contract-tests
blocked_by:
  - chore/commit-untracked-deliverables
files_in_scope:
  - packages/seeder/**
  - pnpm-workspace.yaml
acceptance:
  - pnpm --filter @atlas/seeder typecheck clean
  - pnpm --filter @atlas/seeder test green
  - pnpm deps:check 0 errors
created: 2026-05-10
updated: 2026-05-10
---

## Why

The seeder is the operational embodiment of [ADR 0008 (Atlas-on-Atlas)](../../specs/decisions/0008-atlas-on-atlas.md) — it dogfoods I1 by routing every scenario step through the same ingress as a real tenant. It also closes the test-fabric §11 open question by giving us a content-addressable scenario corpus. Phase 1.3 implements the runner skeleton: pure types + dispatch loop, no I/O, no adapter imports.

## Scope

Create `packages/seeder/` workspace package:

- `package.json`, `src/index.ts`, `src/types.ts`, `src/runner.ts`, `src/idempotency.ts`, `src/canonical-json.ts`, `src/schema.ts`, `test/runner.test.ts`
- Add `packages/seeder` to `pnpm-workspace.yaml`

Out of scope: filesystem adapter (Phase 2), PRNG / axis expansion (Phase 3), sqlite (Phase 4), CLI integration (Phase 2). No `node:crypto` import — go through `@atlas/ports` Crypto port.

## Resume prompt

```
Phase 1.3 of the seeder slice — build the runner skeleton in packages/seeder/.

Read first:
- specs/crosscut/seed-corpus.md (the spec)
- ~/.claude/plans/yeah-do-thst-axis-aware-gleaming-milner.md (the plan)
- ports/src/seed-corpus.ts (port already landed in commit 54b63a1)
- packages/test-fabric/src/ (IntentDriver interface — runner consumes this)

Create exactly these files:
- packages/seeder/package.json — name @atlas/seeder, workspace deps on
  @atlas/ports, @atlas/platform-core, @atlas/test-fabric
- packages/seeder/src/index.ts — public exports
- packages/seeder/src/types.ts — RunOptions, RunResult, Step types
- packages/seeder/src/runner.ts — runScenario(scenario, deps) → walks
  ScenarioStep[] through IntentDriver
- packages/seeder/src/idempotency.ts — derives idempotency-key per step
  from (scenarioId, stepIndex, contentHash)
- packages/seeder/src/canonical-json.ts — stable JSON stringify
  (recursive, sorted keys, no third-party dep)
- packages/seeder/src/schema.ts — exports schema-id constants
  ('seed.scenario.v1', 'seed.fixture.v1', 'seed.template.v1',
   'seed.axis_definition.v1')
- packages/seeder/test/runner.test.ts — at least one passing test:
  2-step scenario walked through a stub IntentDriver, both steps
  dispatched in order, RunResult shape verified.

Edit pnpm-workspace.yaml — add packages/seeder.

Constraints:
- Pure runner. No filesystem, no network, no adapter imports.
  The runner consumes a SeedCorpus instance (from @atlas/ports) and
  an IntentDriver (from @atlas/test-fabric) — both injected.
- All step dispatch goes through IntentDriver, NOT submitIntent directly
  (locked decision — see plan file).
- Use @atlas/ports Crypto port for sha256; do NOT import node:crypto
  directly (atlas-on-atlas hexagon rule).
- Default --retry 0 (fail-fast).

Done bar:
- pnpm --filter @atlas/seeder typecheck clean
- pnpm --filter @atlas/seeder test green
- pnpm deps:check 0 errors

Update tickets/seeder/phase-1.3-runner-skeleton.md log on completion.
Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Migrated from TASK.md "Phase 1.3" entry. Spec is complete (see specs/crosscut/seed-corpus.md, lands via chore/commit-untracked-deliverables).
- 2026-05-10: in-flight → review. Implemented by `module-dev` (opus). Committed in `bd79db0` — 11 files, 678 insertions. Acceptance gates: typecheck clean, 6/6 tests passing, deps:check 0 errors.
  Notable implementation choices for sdet to scrutinise:
  - `IntentDriver` is a *local* interface in `packages/seeder/src/types.ts` because `@atlas/test-fabric` does not yet exist as a workspace package. Re-exported from `src/index.ts`. Will be lifted/replaced when test-fabric lands.
  - `Crypto` is taken via `RunnerDeps.crypto` (`@atlas/ports`); no `node:crypto` import. Test uses a `Pick<Crypto, 'sha256'>`-narrowed stub.
  - Default `retry: 0` (fail-fast) per locked decision.
  - `pnpm-workspace.yaml` has an explicit `packages/seeder` line (redundant under `packages/*` glob; kept per resume prompt).
