---
title: Normalise 11 canonical schema $ids to short form; drop loader aliases
status: review
type: chore
owner: sdet
phase: 2
capability:
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - specs/schemas/contracts/cache_policy.schema.json
  - specs/schemas/contracts/error_envelope.schema.json
  - specs/schemas/contracts/module_manifest.schema.json
  - specs/schemas/contracts/page_create_intent_payload.schema.json
  - specs/schemas/contracts/page_document.schema.json
  - specs/schemas/contracts/page_layout.schema.json
  - specs/schemas/contracts/page_template.schema.json
  - specs/schemas/contracts/policy_ast.schema.json
  - specs/schemas/contracts/render_tree.schema.json
  - specs/schemas/contracts/ui_bundle.schema.json
  - specs/schemas/contracts/widget_manifest.schema.json
  - specs/openapi.tenant.json
  - specs/openapi.operator.json
  - packages/page-templates/src/schemas/**
  - packages/widget-host/src/schemas/**
  - packages/schemas/src/loader.ts
  - packages/schemas/scripts/sync-schemas.ts
acceptance:
  - grep for "atlas-platform.example.com/schemas/" returns 0 hits across .ts/.json/.md/.yaml (excluding ticket logs + archived tickets)
  - all 11 schemas declare bare short-form $ids
  - intra-schema $refs use short-form references
  - loader.ts has no aliases for these schemas (mirrors the event-envelope-rename pattern)
  - pnpm safe vitest run packages/schemas packages/widget-host packages/page-templates packages/seeder adapters/seed-memory apps/atlasctl — all green
  - pnpm safe deps:check 0 errors
created: 2026-05-11
updated: 2026-05-11
---

## Why

Phase 1.4's `event_envelope.schema.json` $id was renamed from a long-URL form to bare `event-envelope.v1` (commit `0aa6a4b`). The agent enumerating other long-URL $ids found 11 more canonical schemas under `specs/schemas/contracts/` plus duplicated copies under `packages/page-templates/src/schemas/`, `packages/widget-host/src/schemas/`, and embedded refs in `specs/openapi.{tenant,operator}.json`.

Matches the pattern established by the event-envelope rename + the seed.*.v1 schemas: single short-form `$id` convention across the repo, loader registers by the schema's own `$id` (no aliases needed). Substrate hygiene; no behavior change expected.

## Scope

**Rename 11 canonical $ids** in `specs/schemas/contracts/` from `https://atlas-platform.example.com/schemas/<name>.v<n>.json` to bare `<short-name>.v<n>`:

| File | Old $id | New $id |
|---|---|---|
| `cache_policy.schema.json` | `...schemas/cache-policy.v1.json` | `cache-policy.v1` |
| `error_envelope.schema.json` | `...schemas/error-envelope.v1.json` | `error-envelope.v1` |
| `module_manifest.schema.json` | `...schemas/module-manifest.v2.json` | `module-manifest.v2` |
| `page_create_intent_payload.schema.json` | `...schemas/page-create-intent-payload.v1.json` | `page-create-intent-payload.v1` |
| `page_document.schema.json` | `...schemas/page-document.v1.json` | `page-document.v1` |
| `page_layout.schema.json` | `...schemas/page-layout.v1.json` | `page-layout.v1` |
| `page_template.schema.json` | `...schemas/page-template.v1.json` | `page-template.v1` |
| `policy_ast.schema.json` | `...schemas/cedar-policy.v1.json` | `cedar-policy.v1` |
| `render_tree.schema.json` | `...schemas/render-tree.v1.json` | `render-tree.v1` |
| `ui_bundle.schema.json` | `...schemas/ui-bundle.v1.json` | `ui-bundle.v1` |
| `widget_manifest.schema.json` | `...schemas/widget-manifest.v1.json` | `widget-manifest.v1` |

**Cascading updates:**
- Intra-schema `$ref`s: e.g., `page_document.schema.json:43` refs `page-layout.v1.json#`
- Embedded copies: `specs/openapi.tenant.json:851` + `specs/openapi.operator.json:25` (both inline `error-envelope.v1.json`)
- Duplicated copies: `packages/page-templates/src/schemas/{page_template,page_layout,page_document}.schema.json` (3 files) and `packages/widget-host/src/schemas/{page_layout,widget_manifest}.schema.json` (2 files)
- Loader: drop any aliases for these schemas in `packages/schemas/src/loader.ts` (the schema's own short-form `$id` makes them discoverable; mirror the event-envelope-rename pattern)
- TS constants: search for `*_SCHEMA_ID` patterns referencing the long-URL form
- Sync pipeline: re-run `pnpm --filter @atlas/schemas sync-schemas` to refresh generated copies

**Out of scope:**
- Widget config schemas under `bundles/standard/src/widgets/*/config.schema.json` and `apps/authoring/src/page-editor/editor-widgets/*.config.schema.json` (8 files) — these use a *different* naming pattern (`/ui/widget/<name>/config.v1.json`). Flag for a separate `chore/widget-config-schema-id-sweep` ticket if normalization is desired.
- Renaming the file basenames (e.g. `policy_ast.schema.json` → `cedar_policy.schema.json`). This is `$id`-only.
- Changing version numbers (e.g. `module-manifest.v2` stays `v2`).

## Resume prompt

```
Normalise 11 canonical schema $ids to short form. Mirror the event-envelope
rename pattern from commit 0aa6a4b.

Read first:
- tickets/archive/chore/event-envelope-schema-id-rename.md (the pattern;
  scope was smaller but mechanics identical)
- specs/schemas/contracts/event_envelope.schema.json (the post-rename
  shape — your 11 schemas should match it)
- packages/schemas/src/loader.ts (where aliases get dropped)
- packages/schemas/scripts/sync-schemas.ts (sync pipeline)

For each of the 11 canonical schemas listed in this ticket's
`files_in_scope`:

1. Edit `specs/schemas/contracts/<name>.schema.json` — change `$id` from
   the long-URL to the bare short-form per the table in this ticket.
2. Update intra-schema `$ref`s within the file (look for `$ref` entries
   that reference long-URL forms of OTHER schemas in this set).
3. Grep for the OLD long-URL string of THIS schema across the entire
   codebase (.ts, .json, .md, .yaml, .openapi.*); update every reference.

After all 11 are renamed:

4. Update specs/openapi.tenant.json and specs/openapi.operator.json —
   both inline the `error-envelope.v1.json` $id.
5. Update duplicated copies in packages/page-templates/src/schemas/
   (page_template, page_layout, page_document) and
   packages/widget-host/src/schemas/ (page_layout, widget_manifest).
   These have their own $id declarations + may have $refs.
6. Drop any aliases in packages/schemas/src/loader.ts that exist for
   these 11 schemas. The schema's own short-form $id should be
   sufficient (the prior event-envelope rename established this pattern).
7. Search for `*_SCHEMA_ID` TS constants referencing the long URL —
   update them.
8. Re-run `pnpm --filter @atlas/schemas sync-schemas` to refresh
   generated copies.

Constraints:
- Substrate hygiene only. No behavior change. If you find behavior that
  appears to change after your edit, you've gone wrong.
- Don't rename file basenames; this is $id-only.
- Don't rename widget config schemas under bundles/ or apps/authoring/
  (different naming pattern, separate concern).
- Use `pnpm safe` for all pnpm calls.

Done bar (verify EACH):
- `grep -r "atlas-platform.example.com/schemas/" --include="*.ts"
   --include="*.json" --include="*.md" --include="*.yaml"` returns 0 hits
  (excluding tickets/archive/** and tickets/chore/schema-id-normalization-
  sweep.md itself).
- `pnpm safe --filter @atlas/schemas sync-schemas` — clean
- `pnpm safe vitest run packages/schemas packages/widget-host
   packages/page-templates packages/seeder adapters/seed-memory
   apps/atlasctl` — all green
- `pnpm safe deps:check` — 0 errors

Update tickets/chore/schema-id-normalization-sweep.md log on completion.
Set status: review and hand to sdet.
Update tickets/INDEX.md.

If you discover the canonical schemas are referenced from non-obvious
places (e.g., dynamic AJV registration by string at runtime), surface
those in your summary — they may need attention separately.
```

## Notes / log

- 2026-05-11: created. Filed after event-envelope-rename agent flagged 11 other long-URL `$id`s in `specs/schemas/contracts/`. Verified scope via grep — actual touched-file count likely ~20-25 once downstream refs are counted (embedded openapi, duplicated copies, TS constants).
- 2026-05-11: sweep executed by `port-adapter-dev`. Renamed 11 canonical `$id`s in `specs/schemas/contracts/` from `https://atlas-platform.example.com/schemas/<name>.v<n>.json` to bare `<name>.v<n>`. Updated intra-schema `$ref` in `page_document.schema.json` (canonical + duplicated copy in `packages/page-templates/src/schemas/`) from long-URL → `page-layout.v1#/definitions/WidgetInstance`. Updated OpenAPI embeds: `specs/openapi.tenant.json:851` + `specs/openapi.operator.json:25`. Updated duplicated copies in `packages/page-templates/src/schemas/` (3 files: page_template, page_layout, page_document) and `packages/widget-host/src/schemas/` (2 files: page_layout, widget_manifest). No loader aliases dropped (none existed for these 11; `loader.ts` only explicitly addSchemas event-envelope). No `*_SCHEMA_ID` TS constants reference the long URL (verified via grep). Re-ran `pnpm safe --filter @atlas/schemas sync-schemas` — clean (22 files, 3 manifests). Vitest across packages/schemas, packages/widget-host, packages/page-templates, packages/seeder, adapters/seed-memory, apps/atlasctl — 114/114 passing across 10 test files. `pnpm safe deps:check` — 0 errors (1 unrelated orphan warning). Done-bar grep clean outside excluded paths (widget config schemas, ticket log, archived ticket).
- 2026-05-11: sdet adversarial review — verdict **clean**. Independent grep for `atlas-platform.example.com/schemas/` returns 10 hits, all in excluded paths: this ticket log, the archived event-envelope ticket, 5 widget config schemas under `apps/authoring/src/page-editor/editor-widgets/`, and 3 under `bundles/standard/src/widgets/` (all explicitly out of scope per ticket; different `/ui/widget/<name>/config.v1.json` naming pattern; follow-up `chore/widget-config-schema-id-sweep` recommended). Broader grep for any other `atlas-platform.example.com` reference: same 10. No dynamic schema-id construction found (`'/schemas/' +`, `\`/schemas/${...}\``, template literals — 0 hits). All 11 canonical `$id`s verified post-rename: `cache-policy.v1`, `error-envelope.v1`, `module-manifest.v2`, `page-create-intent-payload.v1`, `page-document.v1`, `page-layout.v1`, `page-template.v1`, `cedar-policy.v1`, `render-tree.v1`, `ui-bundle.v1`, `widget-manifest.v1`. **Duplicated-copy parity:** `diff` of canonical vs duplicated copies — `page_layout` (page-templates + widget-host) identical to canonical; `page_template` identical; `widget_manifest` identical. `page_document` duplicated copy in `packages/page-templates/src/schemas/` diverges from canonical (`layoutId`/`layoutVersion` data-driven branch + `oneOf` constraint not present in canonical) — this is **pre-existing drift** that predates `bd30daf` (verified via git log on both files), out of scope for this ticket; flag for a separate ticket if alignment desired. The rename touched both copies identically (`$id` + cross-schema `$ref`), so the rename itself preserved the existing divergence shape — no new drift introduced. **sync-schemas pipeline verdict:** the `packages/page-templates/src/schemas/` + `packages/widget-host/src/schemas/` duplicates are **hand-maintained** — `packages/schemas/scripts/sync-schemas.ts` only picks up `catalog.*`, `platform.*`, `authz.*`, `content_pages.*`, `seed.*` patterns + the explicit `event_envelope.schema.json` copy. The agent's manual edits to those 5 duplicated files were therefore load-bearing (sync-schemas would NOT have regenerated them). **OpenAPI embed verdict:** both `specs/openapi.tenant.json:851` + `specs/openapi.operator.json:25` inline `ErrorEnvelope` with the new short-form `$id` and otherwise match the canonical contract (same properties, required fields, additionalProperties, $comment). **Loader path:** the 11 canonical schemas are NOT in `packages/schemas/src/loader.ts`'s static `SCHEMAS` array — they're not centrally registered with AJV. `getSchemaValidator('page-layout.v1', 1)` against the central loader returns `null` (expected). The schemas are consumed via two independent paths: (a) `packages/page-templates/src/document.ts` constructs its own AJV instance and registers `page_layout` + `page_document` locally — exercised by `bundles/standard/test/register-templates.test.ts` which validates seed pages end-to-end through the `$ref` resolution; (b) `adapters/node/src/migrations/seed.ts` reads `cache_policy.schema.json`, `module_manifest.schema.json`, `policy_ast.schema.json` from disk and inserts them as Postgres `schema_registry` rows (rows keyed by underscore IDs, independent of the JSON `$id`). Neither path was broken by the rename. **Coverage gap closed:** added `bundles/standard/test/schema-id-rename.test.ts` with three focused regression assertions — (1) duplicated-copy `$id`s match `page-layout.v1` + `page-document.v1`; (2) `validatePageDocument` accepts a doc with a regions-map WidgetInstance entry, exercising the cross-schema `$ref` resolution; (3) canonical `specs/schemas/contracts/` `$id`s match short form + the intra-schema `$ref` uses short form. If anyone reverts the rename on either canonical or duplicated side, this fires a focused failure instead of a noisy seed-validation cascade. Gates re-run: `pnpm safe vitest run bundles/standard` 5/5 pass (was 2/2 across 2 files; now 3 files). Ready for architect.
