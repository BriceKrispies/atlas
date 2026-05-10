---
title: Seeder Phase 1.5 — SeedCorpus contract test suite
status: scoped
type: test
owner: port-adapter-dev
phase: 1
capability: specs/crosscut/seed-corpus.md
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [agentic-first]
invariants: []
blocks: []
blocked_by:
  - seeder/phase-1.3-runner-skeleton
  - seeder/phase-1.4-adapter-seed-memory
files_in_scope:
  - packages/contract-tests/src/seed-corpus.ts
  - adapters/seed-memory/test/contract.test.ts
acceptance:
  - pnpm --filter @atlas/contract-tests typecheck clean
  - pnpm --filter @atlas/adapter-seed-memory test green (full contract suite, not just smoke)
  - pnpm deps:check 0 errors
created: 2026-05-10
updated: 2026-05-10
---

## Why

Every adapter implementation of a port must pass the same contract test suite — that's how port/adapter parity stays mechanically enforced (same shape as `event-store` contract tests). Without this suite, the in-memory adapter from seeder/phase-1.4-adapter-seed-memory is the only thing that proves the port works; future adapters (fs in Phase 2, sqlite in Phase 4) will drift.

## Scope

Create `packages/contract-tests/src/seed-corpus.ts` — a vitest describe-suite exporting `seedCorpusContract(makeAdapter)` that any adapter implementation can pull in. Wire `adapters/seed-memory/test/contract.test.ts` to use it (replacing the smoke test from seeder/phase-1.4).

Out of scope: writing a second adapter (the fs adapter is Phase 2 / future ticket).

## Resume prompt

```
Phase 1.5 — write the SeedCorpus contract test suite that any adapter
must pass.

Read first:
- specs/crosscut/seed-corpus.md
- ports/src/seed-corpus.ts
- packages/contract-tests/src/event-store.ts (pattern to mirror)
- adapters/node/test/event-store.test.ts:1-17 (consumer-side wiring pattern)

Create packages/contract-tests/src/seed-corpus.ts exporting
`seedCorpusContract(makeAdapter: () => SeedCorpus)` — a vitest
describe-suite covering:

- listScenarios yields all loaded ScenarioRefs in stable order
- listScenarios prefix-filter narrows correctly
- listScenarios tag-filter ANDs across tags
- listScenarios axes-filter narrows correctly (basic case)
- loadScenario(ref) returns body validating against seed.scenario.v1
- loadFixture(ref) returns body validating against seed.fixture.v1
- contentHash is reproducible — same body → same hash across two
  adapter instances
- listScenarios is an AsyncIterable, not a Promise<Array>
  (consumes stream-shape — explicitly assert the iterator protocol,
   don't just spread to array)
- Unknown ref → throws/returns the documented error shape per port doc

Wire adapters/seed-memory/test/contract.test.ts to:
- Construct an InMemorySeedCorpus seeded with the worked-example
  scenarios from specs/crosscut/seed-corpus.md
- Call seedCorpusContract(() => adapter)
- Replace the smoke test from seeder/phase-1.4-adapter-seed-memory

Done bar:
- pnpm --filter @atlas/contract-tests typecheck clean
- pnpm --filter @atlas/adapter-seed-memory test green (full suite)
- pnpm deps:check 0 errors

Update tickets/seeder/phase-1.5-contract-tests.md log.
Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Migrated from TASK.md "Phase 1.5" entry.
