---
title: Test coverage for out-of-band manual DROP DATABASE / DROP ROLE
status: done
type: test
owner: sdet
phase: 2
adr: specs/decisions/0005-custom-schema-storage-strategy.md
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - adapters/node/test/tenant-db-provider.test.ts
acceptance:
  - "test case covers `db_*` populated AND role exists AND database does NOT exist (e.g. manual DROP DATABASE)"
  - "test case covers `db_*` populated AND database exists AND role does NOT exist (e.g. manual DROP ROLE)"
  - "in both cases, `provisionTenantDatabase` converges to a working end state (getPool succeeds)"
  - "pnpm exec atlas-test test/tenant-db-provider.test.ts green (count moves from 14 to 16)"
created: 2026-05-20
updated: 2026-05-20
---

## Why

Architect finding on the `provisioner-hardening` bounce-fix review. The branch logic for `createdDb` and `createdRole` is independent (the predicate at line 503 + the keying at line 588 handle each case mechanically). No dedicated test pins these cross-state cases:

- DB-exists, role-doesn't: operator manually ran `DROP ROLE`; provisioner should CREATE ROLE with fresh password (since `existingPassword` snapshot is still in `db_password`, but `pg_roles` lookup says the role is gone).
- Role-exists, DB-doesn't: operator manually ran `DROP DATABASE`; provisioner should CREATE DATABASE, re-run tenant migrations.

Realistic crash recovery (`(f6)` and `(f6-all-null)`) is covered. These are the manual-intervention-recovery cases — narrower threat model, but the branch logic is reachable and should be pinned.

Architect explicitly did NOT block merge on this; filed as standalone follow-up.

## Scope

**In scope:**
- Two new test cases in `adapters/node/test/tenant-db-provider.test.ts`:
  1. `(out-of-band drop database, role survives)` — provision normally, manually `DROP DATABASE atlas_t_<id>` via raw SQL, re-run `provisionTenantDatabase`, assert end state matches first-time-success.
  2. `(out-of-band drop role, database survives)` — provision normally, manually `DROP ROLE atlas_t_<id>_runtime` via raw SQL, re-run `provisionTenantDatabase`, assert end state matches first-time-success (with whatever the chosen behavior is for resurrecting the role).

**Out of scope:**
- Changing the provisioner implementation. If the tests reveal a real bug in the branch logic, that bug becomes a separate ticket.
- Auto-recovery on `getPool` (e.g. "if you observe NULL state, call provisioner"). The provisioner is the canonical write path; this ticket just covers its existing branches.

## Resume prompt

```
You're the sdet for the provisioner out-of-band coverage follow-up. Architect's review of `provisioner-hardening` noted that the branch logic handles two cross-state cases (manual DROP DATABASE alone, manual DROP ROLE alone) but no test pins them.

Read this ticket file first (`tickets/db-per-tenant-followups/provisioner-out-of-band-state-coverage.md`). Look at `adapters/node/test/tenant-db-provider.test.ts` (the existing `(f6)` and `(f6-all-null)` tests are the closest pattern to mirror).

Your task: add two new test cases that simulate manual operator intervention between provisioning runs. In each case re-run `provisionTenantDatabase` and assert: (a) the missing artifact is recreated, (b) `getPool` succeeds, (c) any password rotation behavior is consistent with the realistic-crash test pattern.

After implementation: pnpm exec atlas-test test/tenant-db-provider.test.ts (should be 16 tests now), append a dated log entry, transition status to `review` for sdet adversarial pass (yes, you're sdet but a different agent invocation re-reviews — file the bar honestly).

If the tests reveal a real bug in the branch logic, file a separate ticket and STOP — don't quietly patch.
```

## Notes / log

- 2026-05-20: created from architect finding on `provisioner-hardening`.
- 2026-05-20: sdet — added two test cases to `adapters/node/test/tenant-db-provider.test.ts`:
  - `(out-of-band drop database, role survives)` — manual `DROP DATABASE` only, re-provision recreates DB + re-runs tenant migrations; `db_password` preserved (because `existingPassword !== null && !createdRole` → `needsFreshPassword=false`); coordinate-only UPDATE; no Provisioned log event; `getPool` authenticates with preserved password.
  - `(out-of-band drop role, database survives)` — operator sequence is `DROP OWNED BY <role> CASCADE` (run from inside tenant DB to revoke grants + drop owned objects) + `REVOKE ALL PRIVILEGES ON DATABASE ... FROM <role>` (to clear datacl) + `DROP ROLE`. Re-provision creates the role with a fresh password (`createdRole=true` → `needsFreshPassword=true`), password-rotating UPDATE writes new `db_password`, Provisioned log event emitted. Asserts the OLD password no longer authenticates via a direct probe (postgres.js raises with `password authentication failed`/28P01).
  - Behavioral note for the DROP DATABASE case: the existing branch logic correctly preserves the password because the runtime role's password in `pg_authid` is cluster-wide and survives DROP DATABASE — `existingPassword` in `tenants.db_password` still matches what's in `pg_roles`, so no rotation needed. Re-grant on the recreated DB lands in Step 4 (`GRANT CONNECT`) + Step 5 (`GRANT USAGE/SELECT/INSERT/UPDATE/DELETE` + default privileges via the provisioner-connected migration session). No bugs uncovered; this is pure adversarial coverage of the architect-flagged branches.
  - Verified: `pnpm exec atlas-test test/tenant-db-provider.test.ts` 16/16 green (was 14/14). Status → `review` per the resume prompt for a future sdet adversarial pass.
- 2026-05-20: sdet (adversarial review) — clean pass, no blockers, two nits filed inline. Predicate at `tenant-db-provider.ts:503` (`createdRole || existingPassword === null`) matches both test cases: DROP-DB → both clauses false → preserve; DROP-ROLE → createdRole true → rotate. DROP DATABASE realism OK: provisioner closes its own tenant connection at the end of Step 5; no `getPool` call lands a runtime pool in the LRU before the DROP, so no `pg_terminate_backend` dance needed. DROP ROLE sequence (`DROP OWNED BY CASCADE` from inside tenant DB, `REVOKE ALL PRIVILEGES ON DATABASE ... FROM`, `DROP ROLE`) is the correct three-step — `datacl` is cleared by the REVOKE so the CREATE ROLE succeeds on the next run. Negative-auth probe is hermetic (try/catch around await, end() in finally, single-shot connection with `max_lifetime: 1`/`idle_timeout: 1`). Absence assertion in test 1 (`expect(provisioned).toBeUndefined()`) is a real absence claim, not a length-zero observation. Nits: (1) the negative-auth match pattern `/password authentication failed|28P01/i` is OR'd — if postgres.js ever drops the human phrase the test silently coarsens to checking nothing recognisable (SQLSTATE rarely appears in `.message`); a stronger pin would `expect(staleMsg).toMatch(/password authentication failed/i)`. (2) `not.toBe(passwordBefore)` is structural — collision probability ~2^-192 is fine but a comment noting "almost certainly different by entropy of base64url(24)" would document the intent for the next reader. Neither blocks merge. Status → `architect`.
- 2026-05-20 (architect): invariant gate — pass. Predicate at `adapters/node/src/tenant-db-provider.ts:503` (`createdRole || existingPassword === null`) is structurally pinned: DROP-DATABASE test asserts password preserved + no Provisioned event (test.ts:861, 896) — inverting predicate would fail both; DROP-ROLE test asserts password rotated + Provisioned event + OLD password fails 28P01 (test.ts:1023, 1030, 1073) — inverting would fail all three. ADR 0005 idempotency: convergence asserted structurally via `getPool SELECT 1` + `_migrations` ledger presence (test.ts:886, 902, 1037). Isolation order-independent via unconditional `beforeEach` drop+reinsert (test.ts:110-119). Test-only slice; `tenant-db-provider.ts` untouched. sdet's two nits (regex OR, entropy comment) are doc-quality — non-blocking. Status → done; archived.
