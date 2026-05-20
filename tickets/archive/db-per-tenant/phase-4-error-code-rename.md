---
title: Rename TENANT_SCHEMA_NOT_PROVISIONED → TENANT_DATABASE_NOT_PROVISIONED
status: done
type: chore
owner: module-dev
phase: 1
adr: specs/decisions/0005-custom-schema-storage-strategy.md
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - specs/crosscut/errors.md
  - modules/**/errors.ts
  - apps/server/**/*.ts
  - adapters/node/**/*.ts
  - tests/**/*.ts
acceptance:
  - "no occurrences of TENANT_SCHEMA_NOT_PROVISIONED remain in code, specs, or tests"
  - "TENANT_DATABASE_NOT_PROVISIONED is documented in specs/crosscut/errors.md (or wherever the canonical error taxonomy lives) with the same shape the old code carried"
  - "every emit-site now uses the new code; every test asserting the old code now asserts the new code"
  - "pnpm typecheck passes; pnpm test passes; pnpm lint passes"
created: 2026-05-20
updated: 2026-05-20
---

## Why

`TENANT_SCHEMA_NOT_PROVISIONED` was the error code the schema-per-tenant version of ADR 0005 used when a tenant's schema didn't exist. Under the revised ADR (db-per-tenant), the boundary is the tenant's database; the schema framing is misleading. Sub-agent kept the old code in `specs/domains/custom-schema/capabilities/object-definition/README.md` intentionally for stability, deferring the rename to a separate slice.

This ticket is that slice. The code change is mechanical (find + replace + update the canonical taxonomy doc + update tests), but it crosses module / app / test boundaries, so it's its own ticket rather than mixed into a phase doing other work.

## Scope

**In scope:**
- Find every occurrence of `TENANT_SCHEMA_NOT_PROVISIONED` in:
  - `modules/**`
  - `adapters/**`
  - `apps/**`
  - `tests/**`
  - `specs/**` (capability specs, error taxonomy)
  - `packages/**`
- Rename to `TENANT_DATABASE_NOT_PROVISIONED`.
- Update error-taxonomy documentation (`specs/crosscut/errors.md` if it exists; otherwise wherever the canonical taxonomy is — search for the old code in `specs/` to find it).
- Update any test that asserts the old code string.
- Verify the HTTP error envelope shape stays the same; only the `code:` string changes.

**Out of scope:**
- Any other error-code renames or taxonomy reorganization.
- Behavior changes (the error is thrown at the same points, with the same shape).
- Changes to the `TENANT_DATABASE_NOT_PROVISIONED` semantics in `PostgresTenantDbProvider` (phase 3 owns that throw site).

## Resume prompt

```
You're the module-dev for db-per-tenant phase 4. Independent of phases 1–3 — you can run in parallel with phase 1.

Read this ticket file first (`tickets/db-per-tenant/phase-4-error-code-rename.md`).

Your task: rename `TENANT_SCHEMA_NOT_PROVISIONED` → `TENANT_DATABASE_NOT_PROVISIONED` everywhere it appears in the Atlas codebase. The rename is mechanical but needs to cover code, tests, and the error-taxonomy spec doc.

Process:
1. `grep -rn "TENANT_SCHEMA_NOT_PROVISIONED" .` to find every occurrence. Expect hits in: a capability spec, possibly tests, possibly an error-taxonomy doc, and possibly throw-sites in modules/adapters.
2. For each occurrence, decide if it's an emit-site, a test assertion, a doc reference, or a stale fragment. Update each appropriately. If you find a stale fragment (e.g. a comment that's no longer accurate), update the surrounding prose so it makes sense post-rename, don't just substitute the string.
3. Verify no occurrences of the OLD code remain: `grep -rn "TENANT_SCHEMA_NOT_PROVISIONED" .` returns empty.
4. Run `pnpm typecheck` + `pnpm test` + `pnpm lint`.

Be careful NOT to rename `TENANT_SCHEMA_NOT_FOUND` or other similar-looking codes if they exist — only the exact string `TENANT_SCHEMA_NOT_PROVISIONED`.

After implementation: append dated log entry to this ticket, transition status to `review` for sdet handoff.
```

## Notes / log

- 2026-05-20: created.
- 2026-05-20: implemented. Scope turned out to be entirely spec-side — the `custom-schema` module / handlers / adapters / tests don't exist yet (forward-looking capability spec). Updated all 7 occurrences in `specs/domains/custom-schema/capabilities/object-definition/README.md` (lines 95, 151, 285, 334, 349, 356, 389). On line 334 the surrounding parenthetical ("Error code name retained for stability; semantically reads as ...") was a stale fragment under the rename — removed it rather than mechanically substituting the string, so the prose still makes sense post-rename. Added `TENANT_DATABASE_NOT_PROVISIONED` (category `TENANT`) to the canonical taxonomy at `specs/error_taxonomy.json` — that is where the error taxonomy machine-readable contract lives; `specs/crosscut/errors.md` references it as the source of truth and didn't itself enumerate the old code. Verified `git grep TENANT_SCHEMA_NOT_PROVISIONED` is empty across tracked files; `TENANT_SCHEMA_NOT_FOUND` and other codes were untouched. `pnpm lint` clean. `pnpm typecheck` and `pnpm test` failures are pre-existing and unrelated (vitest type-defs missing post-`@atlas/test` migration; saml-verifier security test pre-failing on main) — none touch `custom-schema`, `error_taxonomy`, or `tenant_database`. Transitioning to `review` for sdet handoff. Note: the two ticket files under `tickets/db-per-tenant/` still contain the old code name by design — they document the rename itself; the acceptance criterion targets code/specs/tests, not the ticket meta-history.
- 2026-05-20 (sdet): adversarial pass. Findings:
  - **Rename completeness verified.** `grep TENANT_SCHEMA_NOT_PROVISIONED` against the tree finds zero hits outside `tickets/db-per-tenant/phase-3-*.md` and `tickets/db-per-tenant/phase-4-*.md` (both ticket meta-history; not in scope per phase-4's design note). All emit-sites, code, tests, OpenAPI docs, and capability-spec references are clean.
  - **New code is documented in the canonical taxonomy.** `specs/error_taxonomy.json` entry for `TENANT_DATABASE_NOT_PROVISIONED` exists at line 64 with `category: TENANT` and a description that names both the cause (db_* NULL) and the surfacing sites (provider + custom-schema handlers).
  - **Spec object-definition still aligned.** `specs/domains/custom-schema/capabilities/object-definition/README.md` uses the new code consistently; the stale "name retained for stability" parenthetical was correctly removed.
  - **No HTTP test fixture / schema asserts the old string literal.** Verified via grep.
  - **Companion finding from phase 3 carries over: `mapError` doesn't surface the new code as an HTTP envelope.** That's the consumer side of this rename — the new code is in the taxonomy but the only thing that throws it (phase-3's `TenantDatabaseNotProvisionedError`) collapses to `UNMAPPED_ERROR` at the boundary. Pointing to the phase-3 follow-up rather than re-filing.
  - No blockers. Transitioning to `architect`.
- 2026-05-20 (sdet): status → architect.
- 2026-05-20 (architect): signed off. Pure spec-side rename verified via grep; canonical taxonomy in `specs/error_taxonomy.json` updated. Consumer-side wiring lands in `db-per-tenant-followups/error-envelope-mapping`. No blockers. Status → done; archived.
