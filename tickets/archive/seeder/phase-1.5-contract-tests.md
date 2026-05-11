---
title: Seeder Phase 1.5 — SeedCorpus contract test suite
status: done
type: test
owner: architect
phase: 5
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
- 2026-05-10: implemented by `port-adapter-dev`. Created `packages/contract-tests/src/seed-corpus.ts` exporting `seedCorpusContract(makeAdapter)` — 22 tests across six describe blocks: listScenarios shape (4), listScenarios filters (3), listScenarios snapshot-at-iteration-start (4), loadScenario/loadFixture (6), SEED_VALIDATOR_NOT_REGISTERED (2), contentHash determinism (3). Factory shape is `{ corpus, addScenario, addFixture, removeScenario, simulateValidatorMissing }` — adapter-agnostic (no `Map` assumption). Wired `adapters/seed-memory/test/contract.test.ts` as a small bridge that constructs `InMemorySeedCorpus` with backing `Map`s the factory hooks mutate, plus a `vi.spyOn`-based `simulateValidatorMissing`. Three regression pins kept in the adapter file (canonicalJsonStringify order, Date semantics, event-envelope schema-registry) — they test `@atlas/platform-core` and `@atlas/schemas`, not the port. Pinned `contentHash` vector `52140527f2273d4163c2df17c76509106432e74a418e8ae1a179918638940972` (FIXED_SCENARIO worked-example minimal-tenant-bootstrap) lifted from sdet's smoke test. Acceptance: `pnpm safe --filter @atlas/contract-tests typecheck` green; `pnpm safe vitest run adapters/seed-memory` 25 tests / 25 pass; `pnpm safe deps:check` 0 errors (1 pre-existing orphan warning unrelated). Added `typecheck` script to `packages/contract-tests/package.json` (was missing) and `@atlas/contract-tests` to seed-memory devDeps.
- 2026-05-10: sdet adversarial review (Phase 2). Verdict: **clean with caveats** — three concrete coverage gaps found and filled. Coverage cross-check honest (25→25 confirmed by diffing prior `adapters/seed-memory/test/contract.test.ts` against contract+regression split: every prior assertion has a successor; contentHash-stable-across-rebuilds folded into the stronger two-instances test). Gaps added to `packages/contract-tests/src/seed-corpus.ts`: (1) `loadFixture` SEED_VALIDATION_FAILED on malformed fixture body — errors.md taxonomy makes the code generic to scenario+fixture but only the scenario branch was pinned; an fs/sqlite adapter that validated scenarios but silently loaded malformed fixtures would have passed; (2) `axisBindings` echoed on the ScenarioRef for materialized scenarios and explicitly undefined for fixed — port doc declares `axisBindings?` on `ScenarioRef` and the §9 worked example shows it, but only `origin` was asserted; consumers of the axis system rely on the ref carrying the bindings without re-loading the body; (3) snapshot captured at `listScenarios()` call time, NOT at first `Symbol.asyncIterator().next()` — spec §4.1 and port JSDoc both pin "at the moment listScenarios() is called", but every prior snapshot test advanced the iterator immediately, so a lazy fs adapter that walked the directory at first `.next()` would silently pass. Suite is now 25 contract tests + 3 adapter-local regressions = 28 pass. `pnpm safe vitest run adapters/seed-memory` 28/28; `pnpm safe --filter @atlas/contract-tests typecheck` clean. Factory hooks (`addScenario`/`addFixture`/`removeScenario`/`simulateValidatorMissing`) confirmed portable to fs (file mutations) and sqlite (DML); no in-memory `Map` leakage. Worked-example scenario in §9 of the spec uses past-tense event names (`Identity.UserCreated`) where real intents use action form per [`feat 6270a36`](https://example/) — already flagged in prior sdet pass as a should-fix on the SPEC, not on this contract suite. Ready for architect.
- 2026-05-10 (architect Phase 3): **clean**. Hexagonal layering verified — `packages/contract-tests/src/seed-corpus.ts` imports only vitest + `@atlas/ports` types; no `@atlas/adapter-seed-memory`, no `node:crypto`, no HTTP. I3 determinism pin (`52140527…`) is well-specified — `FIXED_SCENARIO` is in-suite (self-contained, no adapter-specific drift). All 5 sibling tickets confirmed archived under `tickets/archive/seeder/`. Phase 1 acceptance bar (`pnpm typecheck` + `pnpm test`) met. Concerns: (a) `simulateValidatorMissing` hook is optional and silently `return`s with a `console.warn` — for the current single adapter this is fine; future fs/sqlite adapters should be required to wire it. (b) Spec §9's `eventType` (past-tense `Identity.UserCreated`) vs. `payload.actionId` (action-form `Identity.User.Create`) duality is explained by the disclaimer at the top of §9 (envelope-schema regex requires 2-segment past-tense; intent dispatch uses actionId) — already addressed by the prior fix-pass `afc6182`. No invariant violations. Phase 1 slice **ready to close**.
- 2026-05-10: done. Merged via main lineage (6a4ed1d → 3f50c78). Archived. **Seeder Phase 1 slice complete.**
