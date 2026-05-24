---
title: Decide sync-schemas pipeline coverage for hand-maintained schema duplicates
status: open
type: spec
owner: spec-keeper
phase: 0
capability:
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - packages/schemas/scripts/sync-schemas.ts
  - packages/page-templates/src/schemas/**
  - packages/widget-host/src/schemas/**
acceptance:
  - decision documented (in a follow-up ticket, an ADR, or inline in the affected packages' README)
  - if "auto-sync": sync-schemas.ts implementation extended + tests pin the regeneration
  - if "hand-maintained": each duplicated schema gets a `$comment` explaining the hand-maintenance contract
created: 2026-05-11
updated: 2026-05-11
---

## Why

Sdet's review of the schema-id-normalization-sweep (commit `70087f7` log) found that:

- `packages/schemas/scripts/sync-schemas.ts` regenerates `catalog.*`, `platform.*`, `authz.*`, `content_pages.*`, `seed.*` patterns + `event_envelope.schema.json` into `packages/schemas/src/generated/`.
- It does **NOT** regenerate the duplicated copies in `packages/page-templates/src/schemas/` (page_template, page_layout, page_document) or `packages/widget-host/src/schemas/` (page_layout, widget_manifest).
- Those 5 duplicated files are hand-maintained — the sweep agent's edits to them were load-bearing.

This is a substrate hygiene risk: any future change to the canonical `specs/schemas/contracts/page_*.schema.json` or `widget_manifest.schema.json` requires a coordinated edit to the hand-maintained duplicate. The page_document case (separate ticket `chore/page-document-canonical-sync`) shows what can go wrong — silent divergence between canonical and duplicate.

This ticket is a **design decision**, not an implementation. Decide:

- **Option A: Pull duplicates into the sync-schemas pipeline.** sync-schemas regenerates them on every run; hand-edits get overwritten. Forces single source of truth.
- **Option B: Document the hand-maintenance contract.** Accept that some packages need their own AJV-compatible copies for build/runtime reasons. Each duplicate gets a `$comment` field naming the canonical it shadows + the sync expectation.
- **Option C: Eliminate the duplicates.** Refactor consumers (`packages/page-templates/src/document.ts`, `packages/widget-host/src/...`) to import the canonical from `@atlas/schemas` directly. Probably requires understanding why duplicates exist in the first place — likely a frontend build/bundle isolation concern.

## Scope

Spec-keeper investigates and decides. The decision lands in one of:
- An ADR under `specs/decisions/` if cross-cutting
- A `$comment` in each duplicate if Option B
- A README note in `packages/schemas/` + `packages/{page-templates,widget-host}/` if Option B
- An implementation follow-up ticket if Option A or C

This ticket transitions `done` when the decision is recorded somewhere. The IMPLEMENTATION (if any) is a follow-up ticket.

Out of scope: implementing whichever option is chosen. File implementation as a separate ticket.

## Resume prompt

```
Decide sync-schemas pipeline coverage for the 5 hand-maintained schema
duplicates in packages/{page-templates,widget-host}/src/schemas/.

Read first:
- packages/schemas/scripts/sync-schemas.ts (current pipeline behavior)
- packages/page-templates/src/document.ts (consumer of duplicates)
- packages/widget-host/src/ — find the AJV registration that loads
  the duplicates
- specs/schemas/contracts/page_template.schema.json + page_layout +
  page_document + widget_manifest (canonical originals)
- tickets/archive/chore/schema-id-normalization-sweep.md sdet log
  (the divergence + hand-maintenance flag)

Investigate WHY the duplicates exist:
- Frontend bundle concerns? (the duplicates live in frontend packages,
  may be inlined into a bundle that can't reach @atlas/schemas at
  runtime)
- Build-time concerns? (the duplicates may be pre-validated at
  build-time without needing the central loader)
- Historical accident? (no current reason; eliminate)

Based on the investigation, pick A/B/C from the ticket's "Why" section.

Record the decision:
- ADR: if A or C requires architectural commitment (likely yes)
- `$comment` in duplicates: if B (no behavior change, just documentation)
- README in affected packages: if B

If A or C: file a follow-up implementation ticket
`chore/sync-schemas-pipeline-extend` or
`chore/eliminate-schema-duplicates` and link it from this ticket's
blocks: field.

Set this ticket status: done once the decision is recorded.

No code changes in this ticket beyond the decision artifact.
```

## Notes / log

- 2026-05-11: created from sdet review of schema-id-normalization-sweep (commit `70087f7` log). LOW priority but a real hygiene concern — silent canonical/duplicate divergence is what the schema-id sweep was trying to mechanically eliminate. Decision-only; implementation lands as follow-up.
- 2026-05-24: **architect followup #2 from the cedar-policy-actions pilot — fold a codegen-drift CI gate into this ticket's decision.** Verified there is NO drift check today: `packages/schemas/scripts/sync-schemas.ts` only copies spec→`generated/` (no `--check` mode), `prepare` regenerates, and no workflow runs a post-regen `git diff --exit-code`. So a spec-side manifest edit without re-running `sync-schemas` (or vice-versa) ships a silent divergence, and `moduleManifests()` reads the **generated** copy — meaning runtime action-registration/role-grants follow the stale copy with nothing red. Repo-wide (every `generated/manifests/*` shares it), surfaced by the DSL slice adding a fourth instance. Recommended gate: CI step `pnpm sync-schemas && git diff --exit-code packages/schemas/src/generated`. The new `modules/identity/test/role-packs.test.ts` runtime-grant tests partially backstop this for DSL only (they read `moduleManifests()`), but that's incidental, not a general gate.
