---
title: Sweep `userId: cmd.principalId` propagation across remaining identity handlers
status: scoped
type: chore
owner: module-dev
phase: 1
capability:
adr:
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - modules/identity/src/handlers/api-key-*.ts
  - modules/identity/src/handlers/idp-*.ts
  - modules/identity/src/handlers/audit-export-config.ts
  - modules/identity/src/handlers/password-set.ts
  - modules/identity/src/handlers/membership-create.ts
  - modules/identity/src/handlers/saml-sp-key.ts
  - modules/identity/src/handlers/scim-token.ts
  - modules/identity/src/handlers/service-principal*.ts
acceptance:
  - grep -rE "userId:\s*cmd\.principalId" modules/identity/src/handlers/ returns 0 hits
  - per-site decision documented in commit message (subject is null, subject is a user/service-principal id, or unchanged with justification)
  - pnpm safe vitest run modules/identity — all tests pass (or pre-existing RED-only failures)
  - pnpm safe deps:check 0 errors
created: 2026-05-11
updated: 2026-05-11
---

## Why

The Stage 2 fix-pass (commit `31a826a`) corrected the subject-vs-actor distinction in 4 identity handlers (invite-accept, invite-issue, oauth-token-revoke, user-create) — `userId: cmd.principalId` was incorrectly stamping the actor (the principal causing the event) into the `userId` envelope field (the subject of the event). Stage 2 fixed these because they were the regression class introduced by replacing `principalId: null` with `PLATFORM_ROBOT_PRINCIPAL_ID`.

But sdet found 23 OTHER handlers with the same `userId: cmd.principalId` pattern (api-key-*, idp-*, audit-export-config, password-set, membership-create, saml-sp-key, scim-token, service-principal). These weren't in Stage 2's regression class because their callers pass *real* operator principals (not the null-to-robot migration), so the audit-pollution didn't surface. But the *pattern* is the same smell: actor leaking into subject. Worth a hygiene sweep.

## Scope

Walk each of the 23 sites. For each, determine the correct `userId` value:
- **`null`** if the event has no User subject (system events, service-principal events with no user binding)
- **`user.userId`** or equivalent if the event is about a specific User
- **`cmd.principalId` retained** if the actor IS the subject (rare but possible — e.g., a user updating their own profile)

Replace each site accordingly. Add a focused regression test per category (one for each of null / user-subject / actor-is-subject) pinning the correct behavior.

Out of scope: handlers OUTSIDE `modules/identity/src/handlers/`. The 23 sites are a contiguous set within identity.

## Resume prompt

```
Sweep userId: cmd.principalId pattern in modules/identity/src/handlers/.

Context: the Stage 2 fix-pass (commit 31a826a) corrected this pattern in
4 handlers. Sdet flagged 23 others as a hygiene candidate. They aren't
broken (their callers pass real principals), but the pattern is the
same actor-vs-subject confusion.

Read first:
- modules/identity/test/unit/platform-robot-principal.test.ts
  ("subject-vs-actor invariant" describe block — the regression pin
  pattern to mirror)
- modules/identity/src/handlers/invite-accept.ts:186-268 (the fix-pass
  exemplar — see how the new userId values were chosen)
- Each of the 23 handler files in this ticket's files_in_scope

For each handler file:

1. Find every `userId: cmd.principalId` occurrence
2. Read the event being emitted and the surrounding context — who is the
   subject of this event?
   - System-only event (no User subject) → userId: null
   - Event about a specific User → userId: user.userId or equivalent
   - Event where actor IS subject (user-updates-own-profile) → leave as
     cmd.principalId, add a one-line comment explaining why
3. Update the call site

After all 23 sites:

4. Add a regression test (or expand an existing one) per category in
   modules/identity/test/unit/. Pattern: assert userId is the expected
   value (not just non-null), so future drift fails loudly.
5. Run gates.

Constraints:
- Don't refactor the surrounding handler code. userId-field change only.
- Don't change actor/principalId — that stays cmd.principalId per ADR 0008.
- Don't add new error paths. Hygiene-only sweep.

Done bar:
- grep -rE "userId:\s*cmd\.principalId" modules/identity/src/handlers/
  returns 0 hits
- pnpm safe vitest run modules/identity — all green except 17
  pre-existing security RED scaffold
- pnpm safe deps:check 0 errors
- New regression tests cover at least: null-subject case, user-subject
  case, and (if any retained) actor-is-subject case

Update tickets/chore/handler-userid-propagation-sweep.md log.
Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-11: created from sdet finding on Stage 2 (commit `70087f7` log). 23 handler sites identified; pattern parallels Stage 2 fix-pass scope but with non-null callers, so not Stage 2's regression class. Pure hygiene; medium priority.
