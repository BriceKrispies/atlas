---
title: Clarify listScenarios snapshot-vs-stream semantics in seed-corpus spec
status: review
type: spec
owner: sdet
phase: 2
capability: specs/crosscut/seed-corpus.md
adr:
vision: [agentic-first]
invariants: []
blocks:
  - seeder/phase-1.5-contract-tests
blocked_by: []
files_in_scope:
  - specs/crosscut/seed-corpus.md
  - ports/src/seed-corpus.ts
acceptance:
  - specs/crosscut/seed-corpus.md §4.1 (or wherever listScenarios is described) pins one of {snapshot-at-iteration-start, live-stream} as the contract
  - ports/src/seed-corpus.ts listScenarios doc comment matches the spec
  - the choice is rationale-documented (one sentence on why)
created: 2026-05-10
updated: 2026-05-10
---

## Why

Sdet Phase 2 flagged: `specs/crosscut/seed-corpus.md` §4.1 says `listScenarios` is "streaming," but the Phase 1.4 in-memory adapter takes a snapshot at iteration-start (concurrent `addScenario` calls during iteration don't show up). Both interpretations are defensible; the spec doesn't disambiguate.

Phase 1.5 contract tests need this pinned — they have to assert against one behavior or the other. fs (Phase 2) and sqlite (Phase 4) adapters also need to know which to implement.

## Scope

Pick one semantic and pin it in the spec + the port doc comment. Recommendation from sdet: **snapshot-at-iteration-start** is the safer default for fuzz reproducibility (a scenario run is deterministic w.r.t. the corpus state at the time the iterator started). But the spec-keeper makes the call; if there's a stronger reason for live-stream, document why.

Out of scope: the worked-example addition (separate ticket); any code changes (the in-memory adapter already implements snapshot — once spec confirms, no work needed; if spec picks live-stream, that's a code change in a follow-up ticket).

## Resume prompt

```
Pin the listScenarios semantics in specs/crosscut/seed-corpus.md.

Read first:
- specs/crosscut/seed-corpus.md §4.1 (the current "streaming" wording)
- ports/src/seed-corpus.ts (listScenarios doc comment, signature)
- adapters/seed-memory/src/in-memory-seed-corpus.ts (snapshot-at-iter
  implementation, around the listScenarios method)
- adapters/seed-memory/test/contract.test.ts (sdet's regression test
  that pins snapshot-at-iter-start)

Decide between:
(a) Snapshot-at-iteration-start — iterator is materialised when
    listScenarios() is called; later add/remove operations don't
    affect the iterator.
(b) Live-stream — iterator yields entries that exist at each `next()`
    call; concurrent add/remove during iteration is visible.

Recommended: (a) — fuzz reproducibility, simpler for fs/sqlite
adapters, matches the current in-memory implementation.

Edit specs/crosscut/seed-corpus.md §4.1 to use precise language about
the chosen semantic. Replace "streaming" if it's misleading; if (a),
say "iterator snapshots the corpus at construction; concurrent
mutations are not observed by the iterator." If (b), say so explicitly.

Add one sentence of rationale (e.g., "snapshot semantics support
deterministic fuzz reproduction — a scenario run derives its corpus
view at start and is unaffected by concurrent edits during the run").

Edit ports/src/seed-corpus.ts listScenarios doc comment to match.

Constraints:
- No code changes (the implementation already matches recommendation
  (a); only the spec + port doc comment change).
- If you pick (b), DO NOT change adapter code — file a follow-up
  ticket for the adapter to implement live-stream. The spec change
  is independent.

Done bar:
- specs/crosscut/seed-corpus.md §4.1 pins one semantic with rationale
- ports/src/seed-corpus.ts listScenarios JSDoc matches
- pnpm safe vitest run adapters/seed-memory still passes (no code
  changes expected)

Update tickets/seeder/spec-streaming-vs-snapshot-clarify.md log on
completion. Set status: review and hand to sdet.
```

## Notes / log

- 2026-05-10: created from sdet + architect concerns on seeder Phase 1.4. Blocks Phase 1.5 contract tests.
- 2026-05-10: spec-keeper picked **snapshot-at-iteration-start**. Rationale: fuzz reproducibility — a run's corpus view is fixed at start so concurrent mutations don't perturb a deterministic seed. Edited `specs/crosscut/seed-corpus.md` §4.1 with explicit semantic + rationale; updated `ports/src/seed-corpus.ts` `listScenarios` JSDoc to match. No code changes — the in-memory adapter already implements this semantic and sdet's regression test pins it. No follow-up ticket needed.
