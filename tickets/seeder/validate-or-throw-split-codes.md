---
title: Split SEED_VALIDATION_FAILED into distinct codes for "schema not registered" vs "body invalid"
status: review
type: refactor
owner: sdet
phase: 2
capability: specs/crosscut/seed-corpus.md
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - adapters/seed-memory/src/in-memory-seed-corpus.ts
  - adapters/seed-memory/test/contract.test.ts
  - specs/crosscut/errors.md
acceptance:
  - SEED_VALIDATION_FAILED is raised only for body-fails-schema; a distinct code (e.g. SEED_VALIDATOR_NOT_REGISTERED) covers schema-not-registered
  - specs/crosscut/errors.md lists both codes with parallel wording
  - regression test in adapters/seed-memory/test/contract.test.ts pins each code to its condition
  - pnpm safe --filter @atlas/adapter-seed-memory typecheck + test clean
  - pnpm safe deps:check 0 errors
created: 2026-05-10
updated: 2026-05-10
---

## Why

Sdet Phase 2 + architect Phase 3 both flagged `validateOrThrow` in `adapters/seed-memory/src/in-memory-seed-corpus.ts:147` as overloading `SEED_VALIDATION_FAILED` for two semantically distinct conditions:

1. `loadScenario` / `loadFixture` body fails AJV validation (caller's data is wrong)
2. AJV registry returns null for the schema id (loader misconfiguration; caller's environment is wrong)

Conflating these makes error handling and observability harder — a tenant-data-bug looks the same as a platform-config-bug. Easy fix; clean error contract.

## Scope

Add a second error code (`SEED_VALIDATOR_NOT_REGISTERED` or similar — judge against the existing `errors.md` shape) for the schema-not-registered path. Update `validateOrThrow` to raise the appropriate code per condition. Pin both with regression tests. Add the new code to `specs/crosscut/errors.md` parallel to the existing Seeder Errors entries.

Out of scope: any other error-code reshuffling. Don't touch `SEED_SCENARIO_NOT_FOUND` / `SEED_FIXTURE_NOT_FOUND` / etc.

## Resume prompt

```
Split the overloaded SEED_VALIDATION_FAILED in
adapters/seed-memory/src/in-memory-seed-corpus.ts.

Read first:
- adapters/seed-memory/src/in-memory-seed-corpus.ts (focus on
  validateOrThrow around line 147 and its callers in loadScenario /
  loadFixture)
- specs/crosscut/errors.md (Seeder Errors section — match the format)

Changes:
1. Pick a name for the new code. Recommend SEED_VALIDATOR_NOT_REGISTERED
   to match the existing SEED_*_NOT_FOUND pattern. Confirm against any
   convention in errors.md.
2. In validateOrThrow, branch:
   - If getSchemaValidator(schemaId) returns null → raise the new code
   - If validation fails (validator returns false) → raise
     SEED_VALIDATION_FAILED (unchanged)
3. Add an entry to specs/crosscut/errors.md right after
   SEED_VALIDATION_FAILED's row.
4. In adapters/seed-memory/test/contract.test.ts, add a regression test
   that pins SEED_VALIDATOR_NOT_REGISTERED for the "schema not in
   AJV registry" condition. Existing SEED_VALIDATION_FAILED tests stay
   green (they cover the body-invalid path).

Constraints:
- Keep validateOrThrow's signature and call sites unchanged.
- Don't touch any other error code.
- Don't refactor unrelated code.

Done bar:
- pnpm safe --filter @atlas/adapter-seed-memory typecheck clean
- pnpm safe vitest run adapters/seed-memory — all tests pass
- pnpm safe deps:check 0 errors

Update tickets/seeder/validate-or-throw-split-codes.md log on completion.
Set status: review and hand to sdet.
```

## Notes / log

- 2026-05-10: created from sdet + architect concerns on seeder Phase 1.4.
- 2026-05-10 (port-adapter-dev): split overloaded code. New code `SEED_VALIDATOR_NOT_REGISTERED` (REGISTRY category) covers the schema-not-in-AJV-registry branch in `validateOrThrow`; `SEED_VALIDATION_FAILED` (VALIDATION) retained for body-fails-schema. `validateOrThrow` signature + call sites unchanged. Added regression test in `adapters/seed-memory/test/contract.test.ts` mocking `getSchemaValidator` to return `null` and asserting the new code (and not the old one) fires. `errors.md` entry inserted directly after `SEED_VALIDATION_FAILED` with parallel wording. Done bar green: typecheck clean, 20/20 tests pass, deps:check 0 errors (1 pre-existing unrelated warning).
