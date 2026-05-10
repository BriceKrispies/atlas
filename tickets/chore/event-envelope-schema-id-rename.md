---
title: Normalise event_envelope.schema.json $id to short form; remove the loader alias
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
