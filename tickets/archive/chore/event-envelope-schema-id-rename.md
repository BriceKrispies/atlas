---
title: Normalise event_envelope.schema.json $id to short form; remove the loader alias
status: done
type: chore
owner: architect
phase: 5
capability:
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - specs/schemas/contracts/event_envelope.schema.json
  - packages/schemas/src/loader.ts
  - packages/schemas/scripts/sync-schemas.ts
acceptance:
  - event_envelope.schema.json $id is the short form "event-envelope.v1" matching the seed.*.v1 schemas
  - the alias `addSchema(eventEnvelope, 'event-envelope.v1')` is removed from packages/schemas/src/loader.ts (the schema's own $id makes it discoverable)
  - all existing references to the long-URL $id are updated
  - pnpm safe --filter @atlas/schemas test green
  - pnpm safe vitest run adapters/seed-memory green
  - pnpm safe vitest run packages/seeder green
created: 2026-05-10
updated: 2026-05-10
---

## Why

Phase 1.4's agent added an `addSchema(eventEnvelope, 'event-envelope.v1')` alias to `packages/schemas/src/loader.ts` because the seed.*.v1 schemas `$ref` resolves the short form `"event-envelope.v1#"`, but `event_envelope.schema.json` declares a long URL `$id`. The alias is correct but it's a workaround.

The seed.*.v1 schemas use the short-id convention (`seed.scenario.v1`, etc.) and that's the future direction. Normalising `event_envelope.schema.json`'s `$id` to the short form lets the alias drop. Smaller, cleaner loader; one $id-naming convention for the repo.

## Scope

1. Rename `event_envelope.schema.json`'s `$id` from the long URL to `"event-envelope.v1"`.
2. Grep for any remaining references to the long-URL `$id` — update them.
3. Drop the alias from `packages/schemas/src/loader.ts`.
4. Run gates.

Out of scope: renaming other long-URL `$id`s in `specs/schemas/contracts/` (file separate tickets if there are more — this is event-envelope-only).

## Resume prompt

```
Normalise event_envelope.schema.json's $id and drop the loader alias.

Read first:
- specs/schemas/contracts/event_envelope.schema.json (current $id)
- packages/schemas/src/loader.ts (the alias line, around line 62)
- specs/schemas/contracts/seed.scenario.v1.schema.json + seed.fixture.v1
  (see how they $ref the short id "event-envelope.v1#")

Changes:
1. Edit event_envelope.schema.json — change $id to "event-envelope.v1"
   (drop the long URL prefix).
2. Grep the repo for the OLD long-URL $id string (find what it
   currently is by reading the file first). Update every reference:
   - .ts / .js / .md files
   - Other .schema.json files with $ref entries
3. In packages/schemas/src/loader.ts, remove the
   `addSchema(eventEnvelope, 'event-envelope.v1')` alias line — the
   schema's own $id now does the work.
4. Re-run the schemas/scripts/sync-schemas.ts pass if needed (the
   generated files under packages/schemas/src/generated/ may need a
   rebuild — run `pnpm --filter @atlas/schemas prepare` or whatever
   the convention is).

Done bar:
- grep for the old long-URL string returns 0 hits
- pnpm safe --filter @atlas/schemas typecheck + test green
- pnpm safe vitest run adapters/seed-memory green (the seed-memory
  AJV registration still works without the alias)
- pnpm safe vitest run packages/seeder green
- pnpm safe deps:check 0 errors

Update tickets/chore/event-envelope-schema-id-rename.md log on
completion. Set status: review and hand to sdet.
```

## Notes / log

- 2026-05-10: created from Phase 1.4 implementation note + sdet flag. Cleanup; no behavior change expected, just substrate hygiene.
- 2026-05-10: port-adapter-dev implemented the rename. Changed `specs/schemas/contracts/event_envelope.schema.json` $id from `https://atlas-platform.example.com/schemas/event-envelope.v1.json` to `event-envelope.v1`. Updated `apps/atlasctl/src/envelope-schema.ts` ENVELOPE_SCHEMA_ID constant to match. Dropped the `addSchema(eventEnvelope, 'event-envelope.v1')` alias in `packages/schemas/src/loader.ts` (now just `ajv.addSchema(eventEnvelope)` — the schema's own $id is sufficient). Refreshed comment in `packages/schemas/scripts/sync-schemas.ts`. Re-ran `sync-schemas` to refresh the generated copy. Gates: `pnpm safe --filter @atlas/schemas sync-schemas` clean; `pnpm safe vitest run adapters/seed-memory` 20/20 pass; `pnpm safe vitest run packages/seeder` 23/23 pass; `pnpm safe vitest run apps/atlasctl` 22/22 pass; `pnpm safe deps:check` 0 errors (1 pre-existing orphan warning); grep for the old long-URL string returns 0 hits. `pnpm safe typecheck` has pre-existing failures in `modules/identity/test/**` unrelated to this ticket (verified by re-running with changes stashed — same errors). Other long-URL $ids in `specs/schemas/contracts/` remain (error_envelope, cache_policy, page_*, widget_manifest, ui_bundle, render_tree, policy_ast, module_manifest); flagged for separate tickets per the out-of-scope note.
- 2026-05-10: sdet adversarial review — verdict **clean**. Independent grep for the old long-URL `$id` (`atlas-platform.example.com/schemas/event-envelope`) returns 0 hits across all extensions; the only remaining references to the *short* form `event-envelope.v1` are the canonical `$id`, the two `$ref` sites in `seed.scenario.v1.schema.json` + `seed.fixture.v1.schema.json` (both resolve correctly via the renamed `$id`), the loader call site, the atlasctl `ENVELOPE_SCHEMA_ID` constant + its three consumers, the `sync-schemas` comment, and ticket logs. The agent's "11 other long-URL `$id`s" count verified (`error_envelope`, `cache_policy`, `page_template`, `page_layout`, `page_document`, `page_create_intent_payload`, `widget_manifest`, `ui_bundle`, `render_tree`, `policy_ast`, `module_manifest`); none are `$ref`'d by event-envelope or the seed schemas — out-of-scope is safe. `ENVELOPE_SCHEMA_ID` is defined once (`apps/atlasctl/src/envelope-schema.ts:10`) and imported by `commands/version.ts` + `commands/intents/validate.ts` — no parallel constant elsewhere, no silent drift risk. Pre-existing identity typecheck failures confirmed independent of this slice (verified by stash + typecheck; same errors with slice absent). Coverage gap fixed: added a focused regression test `regression: getSchemaValidator("event-envelope.v1") returns a usable validator (no loader alias needed)` to `adapters/seed-memory/test/contract.test.ts`. The test pins both the AJV bare-`$id` registration behaviour and the loader contract — if anyone reverts the `$id` to a long URL (or removes the schema registration entirely) without restoring an alias, this fires a focused failure instead of a noisy seed-validation cascade. Gates re-run with the regression: `pnpm safe vitest run adapters/seed-memory` 24/24 pass (was 22/22). Ready for architect.
- 2026-05-10 (architect Phase 3): clean. `specs/schemas/contracts/event_envelope.schema.json:3` now declares `$id: "event-envelope.v1"`; `packages/schemas/src/loader.ts:60` registers the schema by its own `$id` (alias dropped). `apps/atlasctl/src/envelope-schema.ts:10` `ENVELOPE_SCHEMA_ID` constant matches. Grep for the old long-URL string returns 0 hits (excluding this ticket's log). I1 schema gate preserved — `getSchemaValidator('event-envelope.v1', 1)` resolves at every consumer site. Ready for merge.
- 2026-05-10: done. Merged via main lineage (eda4257 → 0aa6a4b → 6270a36). Archived.
