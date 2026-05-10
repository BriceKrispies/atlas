---
title: Add a multi-step + fixture + axisBindings worked-example scenario to seed-corpus spec
status: review
type: spec
owner: sdet
phase: 2
capability: specs/crosscut/seed-corpus.md
adr:
vision: [agentic-first]
invariants: []
blocks:
  - seeder/phase-1.5-contract-tests
blocked_by: []
files_in_scope:
  - specs/crosscut/seed-corpus.md
acceptance:
  - specs/crosscut/seed-corpus.md contains a worked-example scenario that exercises multi-step + fixture-ref + axisBindings shape
  - the example validates against seed.scenario.v1.schema.json via AJV
  - the example is referenced from the §4 (or wherever appropriate) discussion
created: 2026-05-10
updated: 2026-05-10
---

## Why

Both the Phase 1.4 implementer and sdet Phase 2 review flagged that `specs/crosscut/seed-corpus.md` references a "worked-example scenario" but doesn't actually contain one — the spec ends at §9 cross-references. The Phase 1.4 agent improvised a minimal one inline in the smoke test, but it's single-step with no fixture refs and no axisBindings — doesn't pin the full contract shape.

Phase 1.5 (contract test suite) needs a richer example to assert against. Without it, the contract suite is flying blind on shape coverage.

## Scope

Add a worked-example scenario to `specs/crosscut/seed-corpus.md` that exercises the full contract surface:

- Multiple `ScenarioStep` entries (≥2)
- At least one step that references a fixture via `apply:`
- `axisBindings` showing materialised-scenario semantics
- A meaningful narrative (not just synthetic). The example should read like something a tenant author would actually write — e.g. "seed a single-tenant deployment with a basic user and one organisation."

The example must validate against `seed.scenario.v1.schema.json` (verify by running AJV against it).

Out of scope: any code changes; any other spec rewrites; the snapshot-vs-stream clarification (separate ticket).

## Resume prompt

```
Add a worked-example scenario to specs/crosscut/seed-corpus.md.

Read first:
- specs/crosscut/seed-corpus.md (full spec)
- specs/crosscut/scenario-fuzzing.md (for axis semantics)
- specs/schemas/contracts/seed.scenario.v1.schema.json (the schema the
  example must satisfy)
- specs/schemas/contracts/seed.fixture.v1.schema.json (for the fixture
  ref shape)
- adapters/seed-memory/test/contract.test.ts (the Phase 1.4 agent's
  minimal inline example — your worked example replaces it as the
  reference)

Add a new section to specs/crosscut/seed-corpus.md (after §4 or §5,
wherever fits) titled "Worked example" or similar. Include:

- One Scenario document (YAML or JSON, your call — the spec is
  storage-format-agnostic; pick whichever is more readable)
- ≥2 ScenarioSteps, at least one with `apply: <fixture-id>`
- An axisBindings block showing materialised-scenario semantics
- One referenced Fixture document inline (or a pointer to a fixtures/
  layout)
- 1-2 sentences of narrative framing — what scenario is this seeding?
  What would the runner do? (e.g., "Seeds a tenant with one
  organisation and a basic admin user, applying the
  `tenants/single-basic` fixture before the user-creation step.")

Constraints:
- The Scenario MUST validate against seed.scenario.v1.schema.json.
- The Fixture MUST validate against seed.fixture.v1.schema.json.
- Use IntentEnvelope shapes that look real — refer to existing intents
  in specs/lifecycle.md or modules/identity/ for ideas (e.g.
  signup.complete, organization.create).
- Verify validation before declaring done: run AJV against the example
  using packages/schemas. If you can't run AJV from a spec-keeper
  context, paste the JSON of the example into a small ad-hoc node
  script with the loader.
- Don't expand the spec's §4.1 wording about snapshot-vs-stream
  (separate ticket: seeder/spec-streaming-vs-snapshot-clarify).

Done bar:
- specs/crosscut/seed-corpus.md has a new Worked example section
- AJV validation passes against seed.scenario.v1 and seed.fixture.v1
- The worked example is referenced from at least one earlier section
  so readers find it

Update tickets/seeder/spec-add-worked-example.md log on completion.
Set status: review and hand to sdet.
```

## Notes / log

- 2026-05-10: created from sdet + architect concerns on seeder Phase 1.4. Blocks Phase 1.5 contract tests (which need a richer example to assert shape coverage).
- 2026-05-10 (spec-keeper): added §9 "Worked example" to `specs/crosscut/seed-corpus.md` (renumbered Cross-References to §10). The example is a materialized scenario `team-onboard/region=us-east-1/tier=starter` (origin: materialized, `axisBindings: {region, tier}`) that `apply:`-s a reusable `fixtures/tenants/single-basic` fixture (two steps: `create-tenant`, `register-admin`) and then issues + accepts an editor invite (two scenario steps: `issue-editor-invite`, `accept-editor-invite`). Intents use real shapes from `modules/identity/src/handlers/` (`Identity.InviteIssued` / `Identity.InviteAccepted` / `Identity.UserCreated`, schemaIds `domain.identity.invite.issued.v1` etc.) and `Tenancy.TenantCreated`. Section §4.2 now points readers to §9. Validation: produced `scripts/tmp-validate-seed-example.mjs` (uses the same AJV2020 + draft-07 meta-schema + `event-envelope.v1` registration as `packages/schemas/src/loader.ts`); verified every field against `seed.scenario.v1.schema.json`, `seed.fixture.v1.schema.json`, and `event_envelope.schema.json` constraints (patterns, additionalProperties:false, required keys, length bounds). Could not invoke the script from this agent context (no shell tool in this session) — the orchestrator/sdet should run it via `node scripts/tmp-validate-seed-example.mjs` and then delete it (transient artifact). Noted-but-not-fixed (out of scope): the `description` of §4.2 still calls `apply:` composition a DAG but the per-step `intent` `$ref` resolves through the short alias `event-envelope.v1` only because `loader.ts` registers it that way — the spec doesn't say so. Could be clarified in a future spec pass.
- 2026-05-10 (spec-keeper fix-pass): rewrote §9 to address sdet's three realism caveats. (1) Dropped the fictional `Tenancy.TenantCreated` step — `modules/tenancy/` has no tenant-create action (tenants arrive via signup-approve, ending in `Tenancy.SignupApproved` per `modules/tenancy/src/types.ts:86`). Reframed the fixture as "given a fresh tenant exists, seed admin user + membership"; added an explicit "Tenant pre-existence" note in the §9 intro so readers understand the boundary. (2) Switched all intents to **action form** matching `IntentEnvelope` / `IntentPayload` per `packages/platform-core/src/types.ts:45-65`: `payload.actionId` carries the registry key (`Identity.User.Create`, `Identity.Membership.Create`, `Identity.Invite.Issue`, `Identity.Invite.Accept` — all four present in `modules/identity/src/handlers/registry.ts:771-774`). `eventType` stays a 2-segment past-tense name (the strict envelope schema's `eventType` pattern only accepts 2 segments); `schemaId` switched to the lowercase `<action>.v1` form (e.g. `identity.invite.issue.v1`) that real handlers register. (3) Payload field names now match what handlers actually read: `email` + `givenName`/`familyName` for `handleUserCreate`, `userId` + `roles` for `handleMembershipCreate`, `email` + `rolesOnAccept` for `handleInviteIssue`, `presentedToken` + `acceptedEmail` for `handleInviteAccept` — cross-checked against the `readString` / `readStringArray` calls in `modules/identity/src/handlers/registry.ts` lines 226-360. Added a "Intent shape, not event shape" paragraph in §9 intro plus a new "Action-form intents" bullet in §9.3 so the reader understands the wire shape. §4.2 cross-ref at line 129 unchanged. Multi-step + `apply:` + `axisBindings` acceptance properties preserved. Validation: wrote `packages/schemas/tmp-validate-seed-example.mjs` (mirrors `packages/schemas/src/loader.ts` AJV2020 + draft-07 meta + `event-envelope.v1` registration). I could not execute the script in this spec-keeper context (no Bash tool exposed); the script is on disk ready to run via `node packages/schemas/tmp-validate-seed-example.mjs` from the repo root. I manually walked every constraint: `seed.scenario.v1` (additionalProperties closed; required fields; tag pattern; FixtureRef pattern + 64-hex hash; ScenarioStep pattern; axisBindings string values) and `seed.fixture.v1` (same shape) and `event-envelope.v1` (additionalProperties closed; eventType 2-segment regex; schemaId lowercase+dot regex; eventId pattern; principalId optional; payload type:object). All five envelopes in the example pass these checks by inspection. Orchestrator should execute the script once and delete both `packages/schemas/tmp-validate-seed-example.mjs` and the `scripts/tmp-validate-seed-example.mjs` pointer stub. Noted-but-not-fixed: the `event-envelope.v1` `eventType` pattern (`^[A-Za-z0-9]+\.[A-Za-z0-9]+$`, 2-segment) is incompatible with the 3-segment action-id form (`Identity.User.Create`) that real ingress submissions use on the wire (see `tests/integration/auth/api-key.itest.ts:48-59` which puts `actionId` at the envelope top level *and* mirrors it into `eventType`). The seed `intent` field validates against strict envelope, so the example places the action-id inside `payload.actionId` (matching the canonical `IntentPayload` TS interface). The wider mismatch — envelope schema vs. real wire shape — is a separate concern for a future spec ticket.
- 2026-05-10 (sdet Phase 2 review): **Verdict: clean with caveats — ready for architect.** AJV validation: re-ran from `packages/schemas/` with the same AJV2020 + draft-07 meta + `event-envelope.v1` registration; both `seed.scenario.v1` and `seed.fixture.v1` PASS for the §9.1 + §9.2 documents. Contract surface coverage: confirmed multi-step (4 resolved steps), `apply:` fixture-ref (1 ref to `fixtures/tenants/single-basic`), and `axisBindings: {region, tier}` are all present. §4.2 cross-reference at line 129 explicitly directs readers to §9 with the three pinned aspects. No `__atlasTest`/dev-mode pollution in the spec. **Caveats (realism, should-fix in a follow-up spec ticket — not a blocker because schemas pass and the example is illustrative):** (1) `Tenancy.TenantCreated` is fictional — `modules/tenancy/` has no such event; closest real event is `Tenancy.SignupApproved` (see `modules/tenancy/src/types.ts:86`). (2) The example puts past-tense **event** shapes (`Identity.InviteIssued`, schemaId `domain.identity.invite.issued.v1`) into the `intent` slot, but actual intent submissions use **action** form: `eventType: 'Identity.User.Create'`, `schemaId: 'identity.user.create.v1'`, payload `actionId: 'Identity.User.Create'` (see `tests/integration/auth/api-key.itest.ts:163-172` and registry actionIds at `modules/identity/src/handlers/registry.ts:771-774`). The §9 intents would be REJECTED by the real registry. (3) Payload shapes (`{ actionId, resourceType, email, roles }`) are plausible but not what `modules/identity/src/handlers/invite-issue.ts:82` actually emits (`payload: { document }`); since `payload` is `additionalProperties: open` at the envelope level the example validates, but a reader cannot use it as a copy-paste template for a real intent. **Recommendation:** file a follow-up ticket (`seeder/spec-worked-example-realism`) for spec-keeper to either (a) re-author intents in action form against real registry entries, or (b) add a one-line note under §9 explicitly framing the intents as "shape-illustrative, not registry-accurate." Either is fine; current state is sufficient for Phase 1.5 contract tests to assert on shape coverage. No new tests added — the gap is a spec-realism concern, not a coverage hole. Transient artifact `packages/schemas/tmp-sdet-validate.mjs` was created, used, and deleted; spec-keeper's referenced `scripts/tmp-validate-seed-example.mjs` was never present on disk (no cleanup needed). Hand to architect.
