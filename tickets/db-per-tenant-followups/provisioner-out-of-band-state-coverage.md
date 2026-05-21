---
title: Test coverage for out-of-band manual DROP DATABASE / DROP ROLE
status: open
type: test
owner: sdet
phase: 1
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
