---
title: §11 retro — surfacing per-boot identity to test harnesses required a kernel touch
status: done
type: drift-finding
owner: architect
phase: 3
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, tiny-core]
invariants: [I20]
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/bootstrap.ts
  - apps/server/src/routes/health.ts
  - apps/server/test/routes/health.test.ts
acceptance:
  - five §11.2 body fields filled
  - extraction-plan ticket exists at the linked path with status >= scoped
  - architect gate verified the retro per §11.3 (retro exists, five fields filled, linked extraction-plan ticket exists)
created: 2026-05-21
updated: 2026-05-21
---

## 1. What category of change was this?

Test harnesses need a stable per-boot identity surfaced via a standing introspection endpoint, so I20 zero-restart can be mechanically asserted across BDD runs. The category — "the harness needs to know which process answered me" — recurs whenever a new probe wants to assert continuity across two steps (BDD "code lands" → "BDD runs"; load-test "before flag flip" → "after"; operator "before tenant signup" → "after"). Today the answer ships as a hand-added `AppState` field + a hand-added route response key; tomorrow it should be one field on a standing kernel-info introspection payload that already exists.

## 2. What forced it into the kernel?

Two structural couplings, neither avoidable today:

- **`always-on.md` §11.1 row 1**: `apps/server/src/bootstrap.ts` is in the kernel-surface table. Adding `bootId` + `startedAt` is a behavior change to `AppState` construction — every consumer of `AppState` sees a new readonly field, every code path that builds an `AppState` (production `bootstrap()` + test `buildFakeAppState()`) must initialise it. This is the always-on contract's "structural invariant, not configuration" definition of kernel.
- **[I20](../../specs/architecture.md#i20-operator-feature-delivery-is-an-intent)**: the operator-experience invariant. I20 says a tenant-visible change must not require a restart. Probing whether a previous step's process is still alive IS the witness mechanism for I20 — and ironically, today the only way to ship that witness is via the kernel, because there's no standing introspection surface to extend with data instead. The bootstrap touch is the proof that I20's data-not-restart story is incomplete here.
- **[`always-on.md` §2 table row 5](../../specs/crosscut/always-on.md#§2-what-is-restart-required-the-kernel)** (apps/server/src/main.ts framework binding) is adjacent — the route registration changes shape (new response field on `/readyz`) but doesn't re-order or re-mount, so the framework-binding row is not the primary trigger; the bootstrap-behavior change (row 1) is.

The change is therefore kernel by §2 table membership, not by category novelty. The category itself ("expose a piece of runtime identity to operators / harnesses") is exactly the shape the Stage 9 operator surface is being scoped to handle.

## 3. What's the missing seam?

`GET /api/v1/kernel/snapshot` returning `{ bootId, startedAt, version, modules: [...] }`, served by a registered route in a standing kernel-info module rather than ad-hoc. The Stage 9 ticket (`tickets/atlas-on-atlas/stage-9-operator-surface.md`) is already scoped around exactly this surface (it enumerates `GET /api/v1/kernel/modules`, `GET /api/v1/kernel/snapshot`, etc.); we are amending its scope (in the same PR as this retro) to commit to including `bootId` + `startedAt` in the day-one `kernel snapshot` response.

With Stage 9 shipped, the next category-shape change ("harness wants to introspect kernel identity / version / loaded modules") is a data lookup against a fixed contract — no AppState field, no `/readyz` widening, no second bootstrap touch. The harness reads from the standing endpoint; new fields are added inside the existing handler's response payload, which is data-plane behavior under `always-on.md` §3.

`/readyz` itself remains the I20-probe carrier for the smallest case — "is this the same process?" — because liveness/readiness is the only standing public-ish surface today. Stage 9 lifts the richer introspection (`modules: [...]`, `chainVersion`, future identity expansions) off `/readyz` and onto the operator-authed kernel-info route, keeping `/readyz` terse.

## 4. What's the extraction plan?

Path: `atlas-on-atlas/stage-9-operator-surface`
Status at retro time: `scoped` (Stage 9 was scoped on 2026-05-10, before this retro filed)
Acceptance amendment landing in the same PR as this retro: Stage 9's `tickets/atlas-on-atlas/stage-9-operator-surface.md` is edited to add an explicit commitment: the day-one `GET /api/v1/kernel/snapshot` (and/or `GET /api/v1/kernel/modules`) response includes `bootId` and `startedAt` populated from `AppState`, so future kernel-identity introspection (version, modules-loaded, chain-version, anything else operators or harnesses want to compare across a boot) is a data lookup against an existing handler's response — not a fresh kernel touch.

When Stage 9 ships, the implementation reads `state.bootId` / `state.startedAt` already populated by this slice's `bootstrap.ts` work; the field set on `AppState` is reused, not re-added. The category — "expose runtime identity" — moves from "kernel touch each time" to "edit one handler's response payload" (still kernel by `apps/server/routes/kernel.ts` membership, but a much narrower seam, and the typical incremental change is a property add inside an existing handler, not a new field on `AppState` + a new route response shape). That is the seam-narrowing this retro asks Stage 9 to land.

## 5. Confidence the category is now closed

**closed** — the next change of this category lands as data, not as a kernel diff.

Justification: Stage 9 is already scoped, has a concrete file-by-file plan, lists `GET /api/v1/kernel/snapshot` and `GET /api/v1/kernel/modules` as part of its day-one surface, and (after the amendment landing in this PR) commits to including `bootId` + `startedAt` in that day-one response. Once Stage 9 merges, a future test harness wanting (say) a `processStartedPid`, a `chainVersion`, or a `loadedModulesHash` for I20 witness purposes adds a property to the kernel-info handler's response — one file, no `AppState` widening, no `/readyz` widening, no new retro because no `always-on.md` §11.1 row is touched. The day-one inclusion of `bootId` + `startedAt` proves the seam works for the smallest case (this slice's `/readyz` need); subsequent fields are incremental.

The honesty check: Stage 9 is `scoped`, not `done`. If Stage 9 stalls past 90 days, `vision-keeper` will flag the open extraction-plan ticket and this retro's `closed` claim will be re-evaluated. The bet here is that Stage 9 ships well before the next harness-identity-probe slice; that bet is well-founded because Stage 9 itself is one of the highest-leverage tickets on the always-on roadmap (it caps the kernel rewrite) and is already prioritised on `tickets/INDEX.md` as a `scoped` item by spine-owner. If the bet fails, the next retrospective in this category downgrades the confidence to `narrow` or `record`.

## Notes / log

- 2026-05-21: filed alongside the `bootstrap.ts` + `routes/health.ts` kernel touch in `tickets/chore/expose-server-bootid-for-i20-probe.md`. First §11 retrospective filed in Atlas. Status: `scoped` per `_template.md` default — the architect gate on the chore PR verifies the five fields and the extraction-plan link, and archives.
- 2026-05-21: sdet adversarial review of this retro per the FIRST-INSTANCE clause (the chore ticket's review brief escalated review of the retro itself because it sets the calibration for every future §11 retrospective). Verdict per `always-on.md` §11.2 fields:
  - **Field 1 (category sentence):** GOOD. "Test harnesses need a stable per-boot identity surfaced via a standing introspection endpoint..." — greppable, names both the actor (harness) and the surface shape (standing introspection). Future retros can copy this style. **Calibration note for future retros: the sentence is good because it names *both* the consumer ("harness") *and* the structural property ("standing introspection") — sentences that name only one will tend to be too vague.**
  - **Field 2 (forced):** GOOD. Cites §11.1 row 1 (apps/server/src/bootstrap.ts in the kernel-surface table) AND I20 by id with link. Two-cite minimum baseline established.
  - **Field 3 (missing seam):** PARTIAL. Field names a concrete file path candidate (`GET /api/v1/admin/kernel/info`) which is concrete enough, BUT the path diverges from what Stage 9's actual scope says it'll serve (`GET /api/v1/kernel/snapshot` / `GET /api/v1/kernel/modules` — no `/admin/`). This is a cosmetic seam mismatch: the seam still narrows to a standing handler, but the retro and the extraction-plan ticket disagree on the URL. Architect should call: either edit Field 3 to use Stage 9's URLs, or add a one-line note acknowledging the divergence. **Calibration note for future retros: when the missing-seam path is a forecast, the extraction-plan ticket is authoritative — keep the retro's Field 3 in sync with whatever scope amendment landed in the same PR.**
  - **Field 4 (extraction plan):** PASS. Path `atlas-on-atlas/stage-9-operator-surface` verified to exist at `tickets/atlas-on-atlas/stage-9-operator-surface.md` with `status: scoped`, and the same-PR additive amendment to its **In:** scope is the seam-narrowing the retro promised. Verified by `git diff -- tickets/atlas-on-atlas/stage-9-operator-surface.md`: single new "0." bullet under **In:**, `acceptance:` list untouched (which is the right shape — chores don't modify upstream `acceptance:` bars, only scope/notes).
  - **Field 5 (confidence: closed):** PASS as written, WITH the 90-day honesty hedge baked in. Once Stage 9 ships, a future bootId-shape introspection (a new field) is a property add against an existing handler — no AppState diff, no `/readyz` widening. The bet is well-founded. The honesty hedge (vision-keeper re-evaluates if Stage 9 stalls past 90 days, downgrades to `narrow` or `record`) sets the right precedent for future "closed" claims. **Calibration note for future retros: `closed` is only honest when the extraction-plan ticket is concretely scoped AND on the active board AND not already long-stalled. State the re-evaluation condition explicitly.**
  - **§11.3 process compliance:** PASS. Retro filed in the same PR as the kernel touch (working-tree change), not deferred.
  - **Process insight worth capturing for future retros:** the chore ticket and the retro ticket are deliberately separate files. This is the right pattern — the chore ticket carries the implementation acceptance bar (typecheck, tests, both ticket logs), the retro ticket carries the five §11.2 fields and gets verified by architect. Don't collapse them; the two-ticket shape preserves the right separation of concerns (implementation vs. categorical reflection). Future kernel touches should follow this template.
  - Verdict: **PASS for sdet phase**, with the one non-blocking Field 3 inconsistency noted above for architect to call. Status stays `scoped` per §11.3 — architect verifies and archives.
- 2026-05-21: scoped → **done** (architect §11.3 gate verified, agentId a9a90375d8c5b0c4f). **First §11 retrospective in Atlas — archived.** (a) retro exists ✓; (b) five fields all substantive — Field 1 names actor + structural property, Field 2 cites §11.1 row 1 + I20 by id, **Field 3 reconciled at gate** to `GET /api/v1/kernel/snapshot` matching Stage 9 authoritative URL (sdet F1 closed), Field 4 extraction-plan ticket exists at `atlas-on-atlas/stage-9-operator-surface` with status: scoped and additive `In:0` amendment landed (acceptance: list untouched — chore stayed in lane), Field 5 `closed` claim honest with explicit 90-day re-evaluation hedge; (c) linked extraction-plan ticket verified. **Gate 3 decision:** do NOT amend `always-on.md` §11 — the separate-file two-ticket shape is already implicit in §11.3 ("filed in the same PR as the kernel change") + `_template.md`'s placement under `tickets/kernel-extraction/`; the calibration insight from sdet's review is recorded in this log entry instead. If the same pattern-observation surfaces in three more retros without anyone reaching for the spec, escalate then. **Calibration note for the second §11 retro author:** when Field 3's missing-seam path is a *forecast* (the surface doesn't exist yet), treat the same-PR extraction-plan ticket as the authoritative source for the URL — keep the retro and the amendment in sync; mismatch is a non-blocking gate finding the architect resolves at gate, not a merge block. Archiving via `mv` (untracked file) to `tickets/archive/kernel-extraction/`.
