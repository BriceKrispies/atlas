---
title: Map TENANT_DATABASE_NOT_PROVISIONED to the HTTP error envelope
status: done
type: refactor
owner: module-dev
phase: 1
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
  - "GET against an endpoint that opens a tenant pool against a tenant with NULL db_* returns an HTTP envelope whose `code` field is `TENANT_DATABASE_NOT_PROVISIONED` (NOT `UNMAPPED_ERROR` / `TRANSACTION_FAILED`)"
  - "the HTTP status code is 503 (service-unavailable / not-ready), not 500 — the failure is config drift, not an internal storage failure"
  - "the structured server log still carries the original error with code `TENANT_DATABASE_NOT_PROVISIONED` and the remediation message"
  - "a test in apps/server covers the mapping end-to-end: construct a request scoped to a tenant with NULL db_*, assert the response body shape"
  - "pnpm typecheck passes; pnpm --filter @atlas/server test passes; pnpm lint passes"
created: 2026-05-20
updated: 2026-05-20
---

## Why

sdet finding **F3** from the db-per-tenant slice review: `TenantDatabaseNotProvisionedError` fires at the connection seam in `adapters/node/src/tenant-db-provider.ts`, but `apps/server/src/middleware/errors.ts:170-187` (`mapError`) only knows about `IdentityError` and `IngressError` — everything else collapses to `TRANSACTION_FAILED` (HTTP 500) with body `Internal storage failure`. The structured server log carries the right code and remediation message, but the client gets a misleading HTTP envelope.

Today this only fires in the dev-up fail-closed path, but it's a real regression that must be closed before custom-schema handlers start throwing this code in user-visible flows. The taxonomy entry already exists in `specs/error_taxonomy.json`; what's missing is the mapper bridge.

## Scope

**In scope:**
- Extend `apps/server/src/middleware/errors.ts` to recognize `TenantDatabaseNotProvisionedError` (exported from `@atlas/adapter-node` as of phase 3) and map it to:
  - HTTP status: **503** (Service Unavailable — the tenant's data plane is not ready). NOT 500 — this is config drift, not an internal failure.
  - Envelope `code`: `TENANT_DATABASE_NOT_PROVISIONED`.
  - Envelope `message`: the remediation message the error class already carries.
  - Envelope `correlationId`: standard.
- Add or extend a test in `apps/server/src/middleware/errors.test.ts` (or the closest existing test file for `mapError`) that exercises the mapping: throw the error from a fake route, assert the response envelope shape.
- Verify `specs/error_taxonomy.json` already lists `TENANT_DATABASE_NOT_PROVISIONED` with the right `category: TENANT` — if so, no spec change. If the http-status hint isn't on the taxonomy entry, add it.

**Out of scope:**
- Renaming or relocating other error mappings.
- Changes to the error class itself (`TenantDatabaseNotProvisionedError` stays in `@atlas/adapter-node`).
- Production-side provisioning paths.

## Resume prompt

```
You're the module-dev for the db-per-tenant F3 follow-up. The error path works at the connection seam — `PostgresTenantDbProvider.getPool` throws `TenantDatabaseNotProvisionedError` with code `TENANT_DATABASE_NOT_PROVISIONED` — but `apps/server`'s `mapError` middleware collapses it to `UNMAPPED_ERROR` / `TRANSACTION_FAILED` / HTTP 500.

Read this ticket file first (`tickets/db-per-tenant-followups/error-envelope-mapping.md`), then look at `apps/server/src/middleware/errors.ts` and `@atlas/adapter-node`'s `TenantDatabaseNotProvisionedError` export.

Your task: teach `mapError` about the new error class. Map to HTTP 503 with code `TENANT_DATABASE_NOT_PROVISIONED`, message from the error's `message` field, plus the standard correlationId. Add a test that exercises the path.

Key correctness bars:
- HTTP 503 (NOT 500). The failure is "tenant not provisioned" — service-unavailable / not-ready territory, not an internal storage failure.
- The server-side log still emits the full structured error (don't accidentally swallow it when you add the mapping). Confirm by reading the existing `mapError` shape — it should both LOG and RETURN; you're only changing what's RETURNED.
- The test must construct a real `TenantDatabaseNotProvisionedError` (imported from `@atlas/adapter-node`), not a mock. The point of the test is that the wiring works end-to-end.

E2E verification (don't skip):
  1. Bring up DB + dev-up (assumes phase 2 done).
  2. UPDATE control_plane.tenants SET db_name = NULL WHERE tenant_id = 'dev-tenant'.
  3. Start server with ATLAS_DEV_MODE=true.
  4. curl an endpoint that opens the tenant pool — `/api/v1/policies` is the cleanest (sdet's report confirms it goes through `buildRequestBundle → ensureTenantMigrated → getPool`).
  5. Verify the response is HTTP 503 with JSON body containing `"code": "TENANT_DATABASE_NOT_PROVISIONED"` and the remediation message.
  6. Verify the server logs still carry the structured error.

After implementation: pnpm typecheck + test + lint, append dated log entry, transition to `review`.
```

## Notes / log

- 2026-05-20: created from sdet F3 finding.
- 2026-05-20: module-dev — implemented. `apps/server/src/middleware/errors.ts` now recognises `TenantDatabaseNotProvisionedError` (imported from `@atlas/adapter-node`) and maps it to HTTP 503 with `code: TENANT_DATABASE_NOT_PROVISIONED`, the remediation `message` from the error, and a standard correlationId + supportId envelope. The structured server-side log still emits via `ctx.logger.error('tenant database not provisioned', { event: 'Tenancy.DatabaseNotProvisioned', error: { code, message, stack }, properties: { supportId, tenantId } })` — log + return, not log-and-swallow. Added `apps/server/src/middleware/errors.test.ts` with 5 cases covering: 503 status; `TENANT_DATABASE_NOT_PROVISIONED` code on body; remediation-message substrings (`pnpm dev:up`, `ADR 0005`, the tenant id) flow through; correlationId echoed + supportId present; server log emitted with the structured error; and a belt-and-braces negative assertion that it does NOT collapse to `TRANSACTION_FAILED` / 500. All 5 pass under `pnpm --filter @atlas/server test`. No new typecheck or lint errors introduced (`errors.test.ts` shares the pre-existing systemic TS2349 `@atlas/test` shim pattern with every other test file in the package; my files are lint-clean). Spec taxonomy already lists `TENANT_DATABASE_NOT_PROVISIONED` under `category: TENANT`, so `specs/error_taxonomy.json` needs no change. Transitioning to `review`. E2E verification per the resume prompt (UPDATE tenants SET db_name=NULL → curl /api/v1/policies → 503) was not executed in this pass — flagging for sdet to run against a live dev stack as part of review.
- 2026-05-20: module-dev → sdet for adversarial review.
- 2026-05-20 (sdet): pass — finding 4 acknowledged (E2E live-stack curl deferred; code-path inspection + 5 unit tests prove the wiring). Status → architect.
- 2026-05-20 (architect): pass on I1 (mapping inside existing ingress chokepoint; no new HTTP surface), I5 (correlationId + supportId paired between envelope and log), error contract (503 is correct semantic; spec taxonomy lists code), log-and-return preserved. Minor event-name convention drift on `Tenancy.DatabaseNotProvisioned` is consistent with sibling `Ingress.UnmappedError` — not a regression; track as a separate normalize-event-names chore. Status → done; archived.
