---
title: Identity F-CRYPTO + F-SAML production fixes (scoping)
status: open
type: refactor
owner: spine-owner
phase: 0
capability: specs/domains/identity/
adr:
vision: [agentic-first]
invariants: [I2, I4]
blocks: []
blocked_by:
  - chore/commit-untracked-deliverables
  - identity/auth-itest-preflight
files_in_scope:
  - modules/identity/src/saml/**
  - modules/identity/src/handlers/password-login.ts
  - modules/identity/src/sp-key.ts
  - modules/identity/src/authn-request.ts
  - modules/identity/src/webauthn-register.ts
  - modules/identity/src/webauthn-assert.ts
  - apps/server/src/middleware/csrf.ts
  - specs/decisions/
acceptance:
  - all RED tests in modules/identity/test/security/ pass green (or are explicitly handed to sub-tickets)
  - F-SAML deferred findings (1, 3, 4, 16 per helpers.ts:18-22) split into their own tickets with citations
  - identity-hardening ADR exists if not already
created: 2026-05-10
updated: 2026-05-10
---

## Why

Three RED test files in `modules/identity/test/security/` encode 5 F-CRYPTO findings + 5 F-SAML findings (5 active in the test files, 4 deferred per the helper's header comment at `helpers.ts:18-22`). The tests are the contract; production code currently fails them. Identity surface area is a top-tier security concern — agentic-from-day-one with weak crypto/SAML defenses isn't agentic, it's negligent.

This ticket scopes follow-up sub-tickets; it does not fix anything itself.

## Scope

`spine-owner` reads the security tests and files one sub-ticket per finding under `tickets/identity/`. Each sub-ticket goes through the standard slice flow (`port-adapter-dev` for crypto, `module-dev` for SAML/CSRF wiring, then `sdet` → `architect`). If no identity-hardening ADR exists, file one first.

Out of scope: actual production fixes — those happen in the sub-tickets.

## Resume prompt

```
Scope follow-up tickets for the F-CRYPTO and F-SAML findings encoded
as RED tests in modules/identity/test/security/.

Read first (and fully):
- modules/identity/test/security/crypto-posture.security.test.ts
- modules/identity/test/security/saml-verifier.security.test.ts
- modules/identity/test/security/helpers.ts (header comment lines
  18-22 list deferred findings)

If specs/decisions/ does not contain an identity-hardening ADR, file
one first (specs/decisions/00XX-identity-hardening.md). At minimum it
should:
- define the threat model
- list which findings are scope-in (the 5+5 RED tests, plus the 4
  deferred F-SAML findings)
- list which findings are scope-out and why

Then for each finding (5 active in saml-verifier, 5 in crypto-posture,
4 deferred-by-comment in saml helpers — total 14), create one ticket
under tickets/identity/ with slug like:

  tickets/identity/fcrypto-3-scrypt-n.md
  tickets/identity/fsaml-2-sha1-acceptance.md
  ...

Each sub-ticket:
- title: "Identity <finding-id> — <one-line>"
  e.g., "Identity F-CRYPTO-3 — scrypt N≥2^17"
- type: refactor
- files_in_scope: ONLY the file(s) the test points at
- acceptance: the specific RED test now passes green
- blocked_by: [identity/security-fixes]
- adr: link to the identity-hardening ADR
- owner: port-adapter-dev (crypto findings) or module-dev (SAML/CSRF)

Do NOT fix anything in this ticket. After all sub-tickets are filed,
set this ticket status: done with a log entry listing the new ticket
paths in order. Then archive:
  mkdir -p tickets/archive/identity
  git mv tickets/identity/security-fixes.md tickets/archive/identity/security-fixes.md

Update tickets/INDEX.md — remove security-fixes' line (archived);
add lines for all the new sub-tickets under the identity/ section.
```

## Notes / log

- 2026-05-10: created. Findings inventoried via the project state audit at session start. RED tests land via chore/commit-untracked-deliverables.
