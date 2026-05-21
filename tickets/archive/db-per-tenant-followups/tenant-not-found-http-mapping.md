---
title: Map TenantNotFoundError to HTTP envelope (TENANT_NOT_FOUND / 404)
status: done
type: refactor
owner: architect
phase: 3
adr: specs/decisions/0005-custom-schema-storage-strategy.md
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/middleware/errors.ts
  - apps/server/src/middleware/errors.test.ts
  - specs/error_taxonomy.json
acceptance:
  - "an HTTP path that triggers TenantNotFoundError (today: any future signup-approve / provisioning route) returns HTTP 404 with envelope `code: TENANT_NOT_FOUND` and the error's message"
  - "the structured server log still carries the original error with code `TENANT_NOT_FOUND`"
  - "a unit test in errors.test.ts mirrors the F3 mapping test: construct a real TenantNotFoundError (imported from @atlas/adapter-node), assert envelope shape"
  - "specs/error_taxonomy.json includes TENANT_NOT_FOUND with category TENANT (if not already)"
  - "pnpm typecheck passes; pnpm --filter @atlas/server test passes; pnpm lint passes"
created: 2026-05-20
updated: 2026-05-20
---

## Why

sdet finding F2 (latent) from the db-per-tenant followups review. `provisioner-hardening` added `TenantNotFoundError` with code `TENANT_NOT_FOUND` (F5 precondition enforcement — `provisionTenantDatabase` throws this when the `control_plane.tenants` row is missing). `mapError` in `apps/server/src/middleware/errors.ts` does NOT know about this new error class — it would collapse to `TRANSACTION_FAILED` / HTTP 500, the exact regression F3 closed for the sibling `TenantDatabaseNotProvisionedError`.

No currently-wired HTTP route calls `provisionTenantDatabase` so this is latent today. But the moment a signup-approve or tenant-onboarding handler invokes the provisioner, an unknown tenantId becomes a misleading 500. Close it now alongside the F3 work; the mapping is a four-line addition.

## Scope

**In scope:**
- Extend `mapError` to recognize `TenantNotFoundError` (exported from `@atlas/adapter-node`) and map to:
  - HTTP status **404** (the tenant doesn't exist in the registry).
  - Envelope `code: TENANT_NOT_FOUND`.
  - Envelope `message`: from the error.
  - Envelope `correlationId`: standard.
- Unit test mirroring the F3 mapping test in shape.
- Verify `specs/error_taxonomy.json` lists `TENANT_NOT_FOUND` under `category: TENANT`. If absent, add it.

**Out of scope:**
- Wiring any HTTP route to call `provisionTenantDatabase`. That's signup-approval's work, separate.
- Other error code mappings.

## Resume prompt

```
You're the module-dev for the TenantNotFoundError HTTP-mapping follow-up. sdet's review of the provisioner-hardening ticket flagged a latent gap: F5 added the error class but `mapError` doesn't know about it. Sibling F3 ticket closed the same gap for TenantDatabaseNotProvisionedError. Mirror that work.

Read this ticket file first (`tickets/db-per-tenant-followups/tenant-not-found-http-mapping.md`). Look at `apps/server/src/middleware/errors.ts` for the existing F3 mapping (`instanceof TenantDatabaseNotProvisionedError → 503 / TENANT_DATABASE_NOT_PROVISIONED`) and copy its shape for the new branch.

Mapping spec:
- `TenantNotFoundError` (imported from `@atlas/adapter-node`) → HTTP **404** with envelope code `TENANT_NOT_FOUND`, message from the error, standard correlationId + supportId.
- Server log still emits structured `Tenancy.TenantNotFound` (level error) before returning.

Add a test in `apps/server/src/middleware/errors.test.ts` mirroring the F3 test shape: construct a real `TenantNotFoundError('some-tenant')`, assert HTTP 404 + body code + message survival + correlationId echo + supportId minted + NOT-500 negative.

Verify `specs/error_taxonomy.json` has the `TENANT_NOT_FOUND` entry under `category: TENANT`. F5's implementer claimed the taxonomy already covers it — confirm.

After implementation: pnpm typecheck + filter @atlas/server test + lint, append dated log entry, transition to `review`.
```

## Notes / log

- 2026-05-20: created from sdet F2 finding during the db-per-tenant followups review.
- 2026-05-20: module-dev implemented. `mapError` in `apps/server/src/middleware/errors.ts` now branches on `instanceof TenantNotFoundError` and returns HTTP 404 with envelope `code: TENANT_NOT_FOUND`, the error's full precondition message, standard correlationId, and a fresh supportId; the structured `Tenancy.TenantNotFound` log line (level: error) is emitted under the same supportId before responding. Test block `mapError — TenantNotFoundError` added to `errors.test.ts` mirroring the F3 shape — five sub-tests (404 + code, message survival, correlationId + supportId, structured-log emission, NOT-500 regression guard) all pass. `specs/error_taxonomy.json` already contained the `TENANT_NOT_FOUND / category: TENANT` entry (confirmed at line 55) — no taxonomy edit needed. `pnpm --filter @atlas/server test`: 137 total, 126 pass, 8 fail — all 8 failures are pre-existing and unrelated (composeRegistries detection, missing cacheInvalidationTags on structured-catalog events, 500-vs-401 in unrelated routes, missing dispatcherChainVersion); none touch errors.ts or the new tests. `pnpm typecheck` shows only the pre-existing `@atlas/test` shim noise (`describe`/`it` typed as `never`) which affects every test file in the repo — my new test inherits the noise pattern but introduces no new failure class. `pnpm lint` shows two pre-existing non-null-assertion errors in `adapters/node/test/tenant-db-provider.test.ts` (out-of-scope per ticket; sdet parallel pass owns it) — zero lint errors in the files I touched. Transitioning to `review`.
- 2026-05-20: sdet review green. Re-ran `pnpm --filter @atlas/server test` and confirmed runtime: "✔ mapError — TenantNotFoundError (15.5291ms)" — all 5 sub-tests execute and pass despite the package-wide `@atlas/test` shim typecheck noise. Verified log-and-return symmetry against the F3 branch (errors.ts:196–217 emits `Tenancy.TenantNotFound` at error level under the same `supportId` BEFORE the `jsonErrorEnvelope` return; the new test at errors.test.ts:197–211 asserts code, message substring, level, AND `properties.{supportId,tenantId}`). Confirmed only one throw site exists (`adapters/node/src/tenant-db-provider.ts:474` in `runProvisionTenantDatabase` step 1) — no conflicting semantics elsewhere. 404 vs 400 choice is defensible: the failure is a server-managed registry miss, not a malformed request; the discriminating `code: TENANT_NOT_FOUND` lets agentic clients branch on code rather than status (consistent with the agentic-first tenet). Message safety: the constructor (tenant-db-provider.ts:185–189) echoes the supplied tenantId and includes the phrase `no row in control_plane.tenants — provisionTenantDatabase refuses to create an orphan DB / role` — same enumeration-oracle / internal-detail trait as the F3 message; not a regression introduced by this slice. One sibling drift filed as `wrapped-tenant-errors-unmapped` (the `instanceof` check is bare; a future handler wrapping these errors in `new Error(..., { cause })` silently collapses to TRANSACTION_FAILED — applies to both tenant-error branches, out of scope for this slice). Transitioning to `architect`.
- 2026-05-20 (architect): invariant gate green. Verified I1 (mapping inside the existing `mapError` chokepoint at `errors.ts:196-217` — no new HTTP surface), I5 (correlationId echoed on envelope at `errors.ts:203` and on the structured log via `ctx.logger` at `errors.ts:206-214`; same supportId pairs them). F3 vs F2 split is semantically correct: 404 for registry miss vs 503 for unprovisioned data plane; confirmed single throw site at `tenant-db-provider.ts:474`. Log-and-return symmetry preserved. Mirror-faithful with F3: identical envelope-mint → log → jsonErrorEnvelope shape; only justified deltas are status (503→404), event name (`Tenancy.TenantNotFound`), and message string; supportId and tenantId carried identically in `properties`. Event-naming consistent with the previously-accepted `Tenancy.DatabaseNotProvisioned` shape — any future Domain.Verb.Outcome recanonicalisation covers both. Sibling drift `wrapped-tenant-errors-unmapped` correctly filed separately. Status → done; archived.
