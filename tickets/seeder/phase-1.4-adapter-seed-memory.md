---
title: Seeder Phase 1.4 — adapter-seed-memory + schema registration
status: review
type: capability
owner: sdet
phase: 2
capability: specs/crosscut/seed-corpus.md
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [agentic-first]
invariants: []
blocks:
  - seeder/phase-1.5-contract-tests
blocked_by:
  - chore/commit-untracked-deliverables
files_in_scope:
  - adapters/seed-memory/**
  - packages/schemas/src/loader.ts
  - pnpm-workspace.yaml
acceptance:
  - pnpm --filter @atlas/adapter-seed-memory typecheck clean
  - pnpm --filter @atlas/adapter-seed-memory test green
  - example scenario in specs/crosscut/seed-corpus.md validates against seed.scenario.v1.schema.json via AJV
  - pnpm deps:check 0 errors
created: 2026-05-10
updated: 2026-05-10
---

## Why

The runner (seeder/phase-1.3-runner-skeleton) needs a SeedCorpus implementation to drive against. In-memory adapter is the fastest contract-test substrate (no filesystem, no fixtures-on-disk yet) and mirrors the port-pair pattern used elsewhere (`adapter-policy-stub` for `Policy`, etc.). This ticket also lands the AJV registration so the four `seed.*.v1` schemas are loadable platform-wide.

## Scope

Create `adapters/seed-memory/` workspace package implementing `SeedCorpus` from `@atlas/ports`. Register the four `seed.*.v1` schemas in `packages/schemas/src/loader.ts`. Add the adapter to `pnpm-workspace.yaml`.

Out of scope: the contract-test suite itself (seeder/phase-1.5-contract-tests). For now write a smoke test only — the full suite slots in once Phase 1.5 lands.

## Resume prompt

```
Phase 1.4 of the seeder slice — implement the in-memory SeedCorpus adapter
and register the four seed.*.v1 schemas.

Read first:
- specs/crosscut/seed-corpus.md
- ports/src/seed-corpus.ts (the port — already landed)
- packages/schemas/src/loader.ts:23-37, 52-56 (registration pattern)
- adapters/policy-stub/src/ (a small adapter to mirror the file layout)

Create:
- adapters/seed-memory/package.json — @atlas/adapter-seed-memory, workspace
  deps on @atlas/ports, @atlas/schemas, @atlas/platform-core
- adapters/seed-memory/src/index.ts — InMemorySeedCorpus implementing
  SeedCorpus from @atlas/ports
    • constructor takes Map<scenarioId, Scenario> and Map<fixtureId, Fixture>
    • listScenarios returns AsyncIterable<ScenarioRef> with prefix/tags/axes filter
    • loadScenario / loadFixture validate via AJV before returning
    • contentHash is sha256 of canonical JSON of body — use Crypto port
- adapters/seed-memory/test/contract.test.ts — smoke test only
  (full contract suite arrives via seeder/phase-1.5-contract-tests)

Edit:
- packages/schemas/src/loader.ts — register seed.scenario.v1, seed.fixture.v1,
  seed.template.v1, seed.axis_definition.v1 in the SCHEMAS array.
  Schemas use draft-07; AJV2020 strict mode is fine.
- pnpm-workspace.yaml — add adapters/seed-memory.

Constraints:
- No filesystem. Pure in-memory Maps.
- Validation lazy (on load), not on construct.
- contentHash via @atlas/ports Crypto.sha256, not node:crypto direct.
- Tenant scoping does not apply (corpus is operator-scoped per port doc).

Done bar:
- pnpm --filter @atlas/adapter-seed-memory typecheck clean
- pnpm --filter @atlas/adapter-seed-memory test green (smoke)
- the worked-example scenario in specs/crosscut/seed-corpus.md loads + validates
- pnpm deps:check 0 errors

Update tickets/seeder/phase-1.4-adapter-seed-memory.md log on completion.
Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Migrated from TASK.md "Phase 1.4" entry.
- 2026-05-10: in-flight → review. Implemented by `port-adapter-dev` (opus) in worktree, cherry-picked to main as `0ce9ef4` — 9 files, 489 insertions. Acceptance gates: typecheck clean, 8/8 tests passing, deps:check 0 errors.
  Notable implementation choices for sdet to scrutinise:
  - The "worked-example scenario" referenced in the resume prompt is **absent from `specs/crosscut/seed-corpus.md`** (spec ends at §9 cross-references). Agent created a minimal-but-spec-aligned example inline in the smoke test and asserted AJV validation against `seed.scenario.v1`. Worth a spec follow-up: add the worked example to the spec proper.
  - `seed.*.v1` schemas declare `$schema: draft-07`. AJV2020 needed `addMetaSchema(draft7)` and an alias-keyed `addSchema(eventEnvelope, 'event-envelope.v1')` (because `event_envelope.schema.json`'s `$id` is a long URL while seed schemas reference the short id). Aliasing is scoped to the loader. Suggested follow-up: `chore/event-envelope-schema-id-rename` to normalise `$id`s repo-wide and remove the alias.
  - `listScenarios` snapshots at iteration-start (current behavior). The spec says streaming; if Phase 1.5 contract tests want live-stream semantics (concurrent add during iteration → new entries visible), revisit. Snapshot is one valid interpretation.
  - `Crypto` constructor-injected; node-backed test stub lives only in the test file.
  - `pnpm-workspace.yaml` has an explicit `adapters/seed-memory` line (redundant under `adapters/*` glob; kept per resume prompt).
- 2026-05-10: sdet adversarial review (Phase 2). Verdict: **needs-fix** on one minor (misnamed error code) — otherwise ready for architect Phase 3. Added 13 tests to `adapters/seed-memory/test/contract.test.ts` covering: AJV failure on schemaVersion violation, AJV failure on additionalProperties:false, axes-filter for materialized scenarios, origin=materialized when axisBindings present, snapshot-at-iteration-start semantics, early-break does not leak state, empty corpus, Date collapse to {} (KNOWN GAP), contentHash stability across rebuilds, contentHash stability under shuffled top-level key order, fixture-not-found path. Findings:
  - **should-fix:** `in-memory-seed-corpus.ts:69` — `loadFixture` raises `SEED_SCENARIO_NOT_FOUND` for an unknown fixture id. Should be a fixture-shaped code (e.g. `SEED_FIXTURE_NOT_FOUND`); also need a corresponding entry in `specs/crosscut/errors.md`. Owner: `port-adapter-dev` + `spec-keeper`.
  - **should-fix:** Date objects silently collapse to `{}` in canonical-json output (both copies — adapter and seeder). Two scenarios that differ only in a Date field share a contentHash. Pinned with regression tests in both packages. Owner: `port-adapter-dev` (or extract a single canonical-json into `@atlas/platform-core`).
  - **nit:** `canonicalJsonStringify` duplicated between `packages/seeder/src/canonical-json.ts` and `adapters/seed-memory/src/in-memory-seed-corpus.ts` with subtly different implementations (recursive direct-emit vs canonicalize-then-stringify). Behaviorally equivalent today but a hazard. Owner: `port-adapter-dev` — extract to `@atlas/platform-core` per spec §7 ("Re-export `prngFromSeed`, `sha256Hex`, `canonicalJsonStringify` from `@atlas/platform-core`").
  - **nit:** `validateOrThrow` returns `SEED_VALIDATION_FAILED: schema X not registered` when AJV is misconfigured (i.e. `getSchemaValidator` returns null). The same error code overloads two distinct conditions (validation failure vs registry misconfiguration). Consider distinct codes; out-of-scope for Phase 1.
  - **info:** Snapshot-vs-stream semantics of `listScenarios`. Spec §4.1 says "streaming" but the in-memory adapter takes a snapshot at iteration start. Pinned with a regression test. The fs/sqlite adapters in Phase 2 / 4 will need to choose: re-snapshot per iterator, or live-stream. Recommend `spec-keeper` clarify in the port doc + spec §4.1; the snapshot-at-iter-start choice is the safer default for fuzz reproducibility.
  - **info:** event-envelope alias: `loader.ts:62` aliases `event_envelope.schema.json` to `'event-envelope.v1'`. Verified this does not conflict with existing consumers (no test depends on the long URL `$id`). The alias mechanism would behave correctly even if `addSchema` is called twice, but the loader caches `cachedAjv` so it's not called twice in practice. Robust as-is.
  - **info:** worked-example absent from spec. Phase 1.4 agent's inline `minimalScenario` is single-step, no fixture refs, no axisBindings. It does not exercise the multi-step / fixture-ref / axisBindings shape. Phase 1.5 contract tests should add a richer worked example to the spec proper. Owner: `spec-keeper`.
