---
title: mapError instanceof checks don't see TenantNotFoundError / TenantDatabaseNotProvisionedError when wrapped by a `cause` chain
status: open
type: drift-finding
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
acceptance:
  - "mapError unwraps `Error.cause` (one level minimum) before the TenantNotFoundError / TenantDatabaseNotProvisionedError instanceof checks, OR a unit test pins current behaviour as intentional"
  - "a test case wraps a TenantNotFoundError inside `new Error('outer', { cause: tnfe })` and asserts the resulting envelope is 404 / TENANT_NOT_FOUND (not 500 / TRANSACTION_FAILED)"
  - "same case for TenantDatabaseNotProvisionedError → 503 / TENANT_DATABASE_NOT_PROVISIONED"
  - "pnpm typecheck + pnpm --filter @atlas/server test pass"
created: 2026-05-20
updated: 2026-05-20
---

## Why

sdet review of `tenant-not-found-http-mapping` (and looking back at the F3 `error-envelope-mapping` work) surfaced a latent gap that applies to **both** tenant-related error mappings in `apps/server/src/middleware/errors.ts`.

The `mapError` branches use bare `instanceof TenantNotFoundError` / `instanceof TenantDatabaseNotProvisionedError` checks against the top-level thrown value. If any caller catches one of these and re-throws inside a wrapper (e.g., `throw new Error('failed during signup-approve provisioning step', { cause: tnfe })`), the `instanceof` fails and the request collapses to `TRANSACTION_FAILED` / 500 — exactly the regression the F2/F3 tickets were filed to prevent.

No HTTP route currently wraps these errors today (provisioner is unwired), but the moment a signup-approve / tenant-onboarding handler adds contextual wrapping for logging clarity, the careful 404/503 mapping silently degrades. This is the same class of regression both F2 and F3 closed at the top level; we should close it at the wrapped-cause level too while the mapping is fresh in mind.

## Scope

**In scope:**
- Either add `Error.cause` unwinding to `mapError` before the two instanceof branches (one level is enough; the standard library doesn't have deeper-than-one-level cause patterns), OR
- Add explicit unit tests pinning that wrapped errors fall through to `TRANSACTION_FAILED` and document that callers MUST NOT wrap these classes.

**Out of scope:**
- Wiring any HTTP route to the provisioner (separate slice).
- Changing the IdentityError or IngressError branches' behaviour.

## Resume prompt

```
You're the module-dev for the wrapped-tenant-errors-unmapped drift fix.
sdet's review of `tenant-not-found-http-mapping` flagged that `mapError` in
`apps/server/src/middleware/errors.ts` uses bare `instanceof` against the
top-level thrown value — so a future handler that does
`throw new Error('outer', { cause: tnfe })` collapses to TRANSACTION_FAILED.

Pick a direction:

(A) Defensive: unwind one level of `Error.cause` before the two
    tenant-error instanceof branches. Add tests in errors.test.ts: wrap
    each of TenantNotFoundError and TenantDatabaseNotProvisionedError in
    `new Error('outer', { cause })` and assert the envelope still maps
    to 404 / TENANT_NOT_FOUND and 503 / TENANT_DATABASE_NOT_PROVISIONED.

(B) Strict: leave the bare instanceof. Add tests in errors.test.ts that
    PIN the wrapped case as deliberately falling through to
    TRANSACTION_FAILED / 500, and add a comment in errors.ts saying
    "callers MUST NOT wrap these classes."

Either way the failure mode becomes deterministic — today it's silent.
After implementation: pnpm typecheck + filter @atlas/server test, append
dated log entry, transition to `review`.
```

## Notes / log

- 2026-05-20: filed by sdet during review of `tenant-not-found-http-mapping`. The mapping work was correct as scoped; this is a sibling gap that applies to both tenant-error branches and was out of scope for the original ticket.
