---
title: Identity auth-itest preflight + first green run
status: scoped
type: test
owner: sdet
phase: 1
capability: specs/domains/identity/
adr:
vision: [agentic-first]
invariants: [I1, I5]
blocks:
  - identity/security-fixes
blocked_by: []
files_in_scope:
  - tests/integration/auth/**
  - infra/**
  - apps/server/src/
acceptance:
  - all 7 itests green (api-key, invite-accept, magic-link-signup, mfa-step-up, oauth-client-credentials, password-login, saml-sso)
  - OR a specific itest is `describe.skip` with the skip reason citing a tracked follow-up ticket
  - tests/integration/auth/TODO.md updated to reflect post-run state
  - pnpm test:integration tests/integration/auth/ exits 0
created: 2026-05-10
updated: 2026-05-23
---

## Why

7 Playwright auth itests landed in commit `72738dc` but the suite has never had a clean green run. Until it does, identity changes are hand-tested only — that violates the agentic-first tenet (CI must verify what the agent built). This ticket brings the suite to a state where every test is green or explicitly skipped with a tracked reason.

## Scope

- User-side preflight: stand up Postgres :15433, apps/server :3000, smtp4dev :5080, Keycloak :8081 (with `atlas-realm.json`), set server env (`TENANT_ID=dev-tenant`, `TEST_AUTH_ENABLED=true`, `DEBUG_AUTH_ENDPOINT_ENABLED=true`).
- Agent-side: run the suite, classify failures, patch test-code bugs, file separate tickets for server bugs, update `TODO.md`.

Out of scope: F-CRYPTO/F-SAML production fixes (identity/security-fixes). Production bugs that surface during the run get filed as new tickets, not fixed here unless trivially blocking.

## Resume prompt

```
Bring tests/integration/auth/ to a clean green state.

PREFLIGHT (user must complete BEFORE agent dispatch):
- Postgres :15433 up (make db-up)
- apps/server :3000 up (pnpm --filter @atlas/server dev)
- smtp4dev :5080 up
- Keycloak :8081 with atlas-realm.json imported
- Server env: TENANT_ID=dev-tenant, TEST_AUTH_ENABLED=true,
  DEBUG_AUTH_ENDPOINT_ENABLED=true

Read first:
- tests/integration/auth/TODO.md (full state of the suite)
- modules/identity/test/unit/totp.test.ts (HOTP computation reference
  for the mfa-step-up rewrite path)

Once preflight is up:

1. Run pnpm test:integration tests/integration/auth/. Capture
   pass/fail/skip per file.

2. For each FAIL, classify:
   - test-code bug → patch in-place
   - server bug → file a separate ticket of type:refactor with
     files_in_scope under apps/server/ or modules/. Place it in
     a fitting set folder (e.g., identity/ or a new server-fix set).
     Mark the itest skipped with citation to the new ticket path.
   - infra preflight bug → document in TODO.md, mark blocked.

3. mfa-step-up.itest.ts: choose path. PREFER in-test HOTP computation
   using @atlas/identity primitives (see modules/identity/test/unit/
   totp.test.ts) over adding /debug/totp/code endpoint — fewer
   surface-area concerns.

4. saml-sso.itest.ts: register atlas-platform-sp as a SAML SP in the
   Keycloak realm export. If that's >1h of yak-shaving, describe.skip
   with citation to a new follow-up ticket.

5. invite-accept.itest.ts and api-key.itest.ts: never run before. Run
   them. Document results.

6. Update tests/integration/auth/TODO.md — replace the "known issues"
   section with current state.

Done bar:
- All 7 itests green OR describe.skip with cited follow-up ticket path.
- TODO.md current.
- pnpm test:integration tests/integration/auth/ exits 0.

If new server-bug tickets were filed during the run, list their paths
in the ticket log so the user can see the backlog grew.

Update tickets/identity/auth-itest-preflight.md log; set status: review.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Migrated from `tests/integration/auth/TODO.md` (which lands via chore/commit-untracked-deliverables).
- 2026-05-23: ticket-sweep — cleared stale `blocked_by: chore/commit-untracked-deliverables` (archived/resolved); ticket has no remaining blockers.
