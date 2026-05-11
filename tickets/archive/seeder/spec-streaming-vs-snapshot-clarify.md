---
title: Clarify listScenarios snapshot-vs-stream semantics in seed-corpus spec
status: done
type: spec
owner: architect
phase: 5
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
- 2026-05-10: sdet Phase 2 adversarial review. Verdict: **clean with caveats**. Spec §4.1 wording is unambiguous and explicitly enumerates the excluded mutation kinds ("adds, removes, fs/sqlite writes"); port JSDoc on `ports/src/seed-corpus.ts` matches semantically. Caveats: (a) `specs/crosscut/seed-corpus.md` §4.1 line 91 retains the phrase "uniform streaming avoids buffering" — reads fine as a laziness/back-pressure claim but creates surface friction with the new "snapshot-at-iteration-start" wording two paragraphs down; consider rephrasing to "uniform async iteration avoids buffering" for full consistency (low severity, spec-keeper). (b) Cross-reference at §10 still calls `worker-source.ts` the "streaming-port shape this port mirrors"; harmless but same friction. (c) Pre-existing regression test at `adapters/seed-memory/test/contract.test.ts` line 336 carried a stale comment claiming "port spec ambiguous" — updated and expanded. **Tests added:** rewrote `listScenarios is snapshot-at-iteration-start: post-start adds are NOT observed` (now cites the pinned spec/JSDoc); added `post-start DELETES of not-yet-yielded entries are NOT observed` (pins the remove half of the "adds, removes, fs/sqlite writes" clause — otherwise an adapter could comply by handling adds but not deletes); added `snapshot is per-call: a NEW listScenarios() after a mutation DOES observe the mutation` (pins the documented re-call path). `pnpm safe vitest run adapters/seed-memory/test/contract.test.ts` → 22/22 pass. Ready for architect.
- 2026-05-10 (architect Phase 3): clean. Snapshot-at-iteration-start semantic reinforces I3 determinism (a scenario run's corpus view is fixed at start, so fuzz reproducibility holds even with concurrent corpus edits). Port JSDoc at `ports/src/seed-corpus.ts:32-40` matches the spec; `adapters/seed-memory/src/in-memory-seed-corpus.ts:44` materialises the snapshot. Concern C3 (residual "uniform streaming" copy at line 91) is non-blocking. Ready for merge.
- 2026-05-10: done. Merged via main lineage (eda4257 → 5985528 → 6270a36). Archived.
