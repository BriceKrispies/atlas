---
title: Map TenantNotFoundError to HTTP envelope (TENANT_NOT_FOUND / 404)
status: scoped
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
