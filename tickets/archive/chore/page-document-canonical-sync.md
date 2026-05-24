---
title: Align canonical page_document.schema.json with packages/page-templates copy (resolve pre-existing divergence)
status: scoped
type: chore
owner: first-party-apps-owner
phase: 0
capability:
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - specs/schemas/contracts/page_document.schema.json
  - packages/page-templates/src/schemas/page_document.schema.json
  - packages/page-templates/src/document.ts
  - modules/content-pages/src/**
acceptance:
  - canonical and duplicated page_document.schema.json are in sync (either both contain layoutId/layoutVersion data-driven branch, or both omit it)
  - OR a `$comment` in canonical documents the intentional divergence and why
  - pnpm safe vitest run bundles/standard packages/page-templates modules/content-pages — green
  - pnpm safe deps:check 0 errors
created: 2026-05-11
updated: 2026-05-11
---

## Why

Sdet's review of the schema-id-normalization-sweep (commit `70087f7` log) flagged a **pre-existing divergence** between the canonical and duplicated copies of `page_document.schema.json`:

- `specs/schemas/contracts/page_document.schema.json` — canonical shape
- `packages/page-templates/src/schemas/page_document.schema.json` — has `layoutId`/`layoutVersion` data-driven branch + `oneOf` constraint NOT present in canonical

This predates the schema-id rename (sdet verified via git log on both files). The rename itself preserved the divergence — both copies got `$id` updates, the structural difference was untouched.

Decide: pull the duplicate's data-driven layout branch into canonical (one source of truth), OR document the intentional divergence in canonical's `$comment` field (explaining why the duplicate has additional shape — likely a frontend-only data-driven layout feature).

## Scope

1. Diff the canonical vs duplicated `page_document.schema.json`. Identify the divergent properties (sdet's note flagged `layoutId`, `layoutVersion`, `oneOf`).
2. Trace usage:
   - Canonical is loaded by `adapters/node/src/migrations/seed.ts` → `schema_registry` table. Anyone validating against the canonical sees no layoutId/layoutVersion shape.
   - Duplicate is loaded by `packages/page-templates/src/document.ts` (local AJV). Anyone validating page documents at runtime there sees the divergent shape.
3. Decide:
   - **Option A: Unify on canonical's shape.** Drop layoutId/layoutVersion from duplicate. Verify no code path uses them.
   - **Option B: Unify on duplicate's shape.** Add layoutId/layoutVersion to canonical. Update any downstream consumer that filters on the canonical shape (search index?, projection?).
   - **Option C: Document the intentional divergence.** Add a `$comment` in canonical naming the duplicated copy + the rationale (e.g., "data-driven layout binding is frontend-rendering concern, not control-plane validation").
4. Implement the chosen option.

Out of scope: a broader sync-schemas pipeline decision (separate ticket `chore/sync-schemas-coverage-decision`).

## Resume prompt

```
Resolve the pre-existing divergence between canonical
specs/schemas/contracts/page_document.schema.json and the duplicated
copy in packages/page-templates/src/schemas/.

Read first:
- specs/schemas/contracts/page_document.schema.json
- packages/page-templates/src/schemas/page_document.schema.json
- diff between them (`git diff --no-index ...`)
- packages/page-templates/src/document.ts (the consumer of the duplicate)
- modules/content-pages/src/ (any consumer of the canonical for
  page-document shape)
- adapters/node/src/migrations/seed.ts (loads canonical → schema_registry)
- bundles/standard/test/schema-id-rename.test.ts (the regression pin
  from the schema-id sweep — verify your change doesn't break it)

Decide: Option A (drop divergent from duplicate), Option B (add
divergent to canonical), or Option C (document the divergence).

If Option A or B: implement the schema change, verify all consumers
still resolve correctly.

If Option C: add a `$comment` in canonical explaining the rationale.
Reference packages/page-templates/src/schemas/page_document.schema.json
explicitly so future readers know about the duplicate.

Constraints:
- Whichever option, the canonical and duplicate should END this ticket
  EITHER byte-identical (modulo $id which is short-form everywhere)
  OR explicitly documented as divergent with rationale.
- Don't refactor unrelated schema properties.
- Don't change the $id (that's already short-form post-schema-id sweep).

Done bar:
- canonical and duplicated copies either match OR canonical has a
  `$comment` documenting why they differ
- pnpm safe vitest run bundles/standard packages/page-templates
  modules/content-pages — green
- pnpm safe deps:check 0 errors
- bundles/standard/test/schema-id-rename.test.ts still pins the rename
  (don't regress it)

Update tickets/chore/page-document-canonical-sync.md log.
Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-11: created from sdet review of schema-id-normalization-sweep (commit `70087f7` log). Pre-existing divergence, not caused by this session's renames. Medium priority — single source of truth for canonical shapes matters for consumer correctness.
