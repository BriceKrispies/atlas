---
title: Normalise widget config schema $ids to short form
status: scoped
type: chore
owner: port-adapter-dev
phase: 1
capability:
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - bundles/standard/src/widgets/announcements/config.schema.json
  - bundles/standard/src/widgets/messaging/config.schema.json
  - bundles/standard/src/widgets/spreadsheet-uploader/config.schema.json
  - apps/authoring/src/page-editor/editor-widgets/data-table.config.schema.json
  - apps/authoring/src/page-editor/editor-widgets/heading.config.schema.json
  - apps/authoring/src/page-editor/editor-widgets/kpi-tile.config.schema.json
  - apps/authoring/src/page-editor/editor-widgets/sparkline.config.schema.json
  - apps/authoring/src/page-editor/editor-widgets/text.config.schema.json
acceptance:
  - all 8 widget config schemas declare bare short-form $ids matching `ui.widget.<name>.config.v1` (or whatever convention spec-keeper picks)
  - grep -r "atlas-platform.example.com/schemas/" across .ts/.json/.md/.yaml returns 0 hits outside excluded paths (orphan worktree only)
  - any AJV registration / consumer that loads these schemas continues to resolve
  - pnpm safe vitest run bundles/standard apps/authoring packages/widget-host packages/widget-host packages/page-templates — green
  - pnpm safe deps:check 0 errors
created: 2026-05-11
updated: 2026-05-11
---

## Why

The 11-schema canonical normalization (commit `bd30daf`) explicitly deferred 8 widget config schemas because they use a *different* naming pattern: `https://atlas-platform.example.com/schemas/ui/widget/<name>/config.v1.json`. Their $ids are conceptually parallel to the canonical schemas but in a separate namespace (`ui/widget/<name>/config`).

Bring them into the same short-form convention for repo-wide consistency. After this ticket, NO `atlas-platform.example.com/schemas/` strings should exist in active code paths (the orphan worktree dir at `.claude/worktrees/agent-a6c67b638c98f0c13/` is dead disk litter — unaffected).

## Scope

1. **Pick a short-form convention.** Recommendation: `ui.widget.<name>.config.v1` (dotted, lowercase, matching the canonical `seed.scenario.v1` pattern). Confirm with spec-keeper / first-party-apps-owner if uncertain.
2. **Rename** the `$id` in each of the 8 schemas.
3. **Audit registration paths.** Where are these schemas loaded into AJV? `packages/widget-host/src/` is the likely consumer. Verify they still register under the new short-form id.
4. **Grep verify.** After: `grep -r "atlas-platform.example.com/schemas/" --include="*.ts" --include="*.json" --include="*.md" --include="*.yaml"` returns 0 hits in active paths.

Out of scope: renaming the file basenames; restructuring the widget config namespace.

## Resume prompt

```
Normalise the 8 widget config schema $ids to short form.

Pattern: mirror the canonical sweep from commit bd30daf and the
event-envelope rename from commit 0aa6a4b.

Read first:
- tickets/archive/chore/schema-id-normalization-sweep.md (the
  precedent — same pattern, larger scope)
- specs/schemas/contracts/seed.scenario.v1.schema.json (the
  short-form $id style to mirror, with dotted lowercase convention)
- One of the 8 widget config schemas (e.g.,
  bundles/standard/src/widgets/announcements/config.schema.json) for
  current shape
- packages/widget-host/src/ — find the AJV registration path for
  these schemas

For each of the 8 schemas:
1. Change $id from
   `https://atlas-platform.example.com/schemas/ui/widget/<name>/config.v1.json`
   to bare short form. Recommendation:
   `ui.widget.<name>.config.v1` (dotted lowercase). Confirm convention
   with first-party-apps-owner if uncertain.
2. Grep for the OLD long-URL of THIS schema across the repo; update
   every reference.

After all 8 are renamed:
3. Verify the AJV registration path. If a loader passes the long URL,
   update it. If the loader uses the schema's own $id, nothing to
   update.
4. Run gates.

Constraints:
- Substrate hygiene only. No behavior change.
- Don't rename file basenames.
- Don't restructure the widget config namespace; just the $id.

Done bar:
- grep -r 'atlas-platform.example.com/schemas/' across .ts/.json/.md/.yaml
  returns 0 hits in active paths (orphan worktree dir at
  .claude/worktrees/ excluded — it's dead disk)
- pnpm safe vitest run bundles/standard apps/authoring
  packages/widget-host packages/page-templates — green
- pnpm safe deps:check 0 errors

Update tickets/chore/widget-config-schema-id-sweep.md log on completion.
Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-11: created from schema-id-normalization-sweep deferral (commit `bd30daf` ticket scope notes). LOW priority — substrate hygiene only.
