---
title: Cedar policy gating for Dsl.<Kind>.{Read,List,Validate}
status: open
type: capability
owner: spine-owner
phase: 0
adr: specs/decisions/0007-dsl-substrate-and-authoring-contract.md
vision: []
invariants: [I2]
blocks: []
blocked_by: []
files_in_scope:
  - specs/domains/dsl/expression/module.manifest.json  # add Read/List/Validate actions
  - apps/server/src/routes/dsl.ts  # wire evaluateRead() like authz.ts does
  - bundles/cedar/policies/  # default policies for the new actions
  - tests/bdd/features/dsl/expression-policy.feature  # OPTIONAL — could merge with bdd-roundtrip
acceptance:
  - Three new actions in specs/domains/dsl/expression/module.manifest.json: Dsl.Expression.Read, Dsl.Expression.List, Dsl.Expression.Validate (verb=read/list/read, resourceType=DslArtifact, auditLevel=INFO)
  - routes/dsl.ts wraps each handler in `evaluateRead({ principal, action, resource, ... })` per the pattern at apps/server/src/routes/authz.ts
  - Default Cedar policy permits `admin` role on the three read/validate actions; denies anonymous + unprivileged principals
  - Denied requests return 403 with `POLICY_DENIED` code (no leak of artifact existence)
  - I2 ASSERTED: a denied request causes NO side effects (validate doesn't even parse on policy-deny)
  - Live smoke: curl with admin → 200; curl with unprivileged user → 403
  - Existing dev-tenant smoke-tests still pass (admin role permits)
created: 2026-05-21
updated: 2026-05-21
---

## Why

Slice #5a deliberately deferred Cedar policy gating on the DSL read +
validate routes — the actions weren't yet in the module manifest, and
adding the policyEngine.evaluate() call would deny every request.
Slice #5b landed the Dsl.Expression.Update action; the read/list/validate
actions are still missing from the manifest, and the routes still skip
the evaluate() call.

This is an I2 hole (authz must run BEFORE side effects). For
`validate`, the side effects are minimal (no DB write), but I2 doesn't
distinguish severity — every request that touches a tenant resource
must pass authz first. For `list` and `read`, an unauthorised request
today returns the actual artifact list / source, which is wrong:
tenants might author artifacts that contain sensitive logic (an
expression like `"sk-" + secrets.openai_key | format(...)` is a small
miracle of bad ideas — the policy gate is what protects against it
even though the substrate prohibits ambient I/O).

## Scope

Add the three read/validate actions to the manifest, wire
evaluateRead() into routes/dsl.ts, ship default policies.

In scope:

- Manifest update: append three actions to
  specs/domains/dsl/expression/module.manifest.json:
    Dsl.Expression.Read (verb=read, resourceType=DslArtifact)
    Dsl.Expression.List (verb=list, resourceType=DslArtifact)
    Dsl.Expression.Validate (verb=read, resourceType=DslArtifact)
- routes/dsl.ts update: each handler calls evaluateRead() per the
  pattern at apps/server/src/routes/authz.ts:35-50. Deny → 403 with
  POLICY_DENIED (do NOT leak whether the artifact exists).
- Default Cedar policies in bundles/cedar/policies/ matching the same
  permit-admin shape as Authz.Policy.Read.
- Manifest update is a one-line `actions[]` extension; the
  controlPlaneRegistry picks it up at boot via the existing manifest
  loader (no code change in the registry).
- Update apps/server/src/routes/dsl.ts header comment — slice #5a put
  a "deliberately skipped" note there explaining the deferral. Replace
  with the live policy-check description.

Out of scope:

- A separate `principalAttributes`-based gate (e.g. "only the artifact's
  createdBy can read it"). Defer; admin/non-admin is enough for v1.
- Per-artifact ACLs. The substrate doesn't model artifact ownership
  beyond `createdBy`/`updatedBy` text fields; per-artifact policy needs
  a richer resource model.
- Template + query DSL actions. Each new DSL kind ships its own
  Read/List/Validate triple in its own manifest — separate tickets
  (one per kind, paired with the kind's authoring ticket).

## Resume prompt

```
You are the spine-owner. Wire Cedar policy gating onto the DSL read +
validate routes — slice #5b explicitly deferred this, and the gap is
an I2 violation today.

Read these first:
- specs/architecture.md §"I2" (authz before side effects)
- apps/server/src/routes/authz.ts (the worked example to mirror — see
  evaluateRead() call shape lines 35-60)
- apps/server/src/routes/dsl.ts (the routes to gate — note the header
  comment explaining the deferral; replace it with the live wiring)
- specs/domains/dsl/expression/module.manifest.json (where the three
  new actions live)
- bundles/cedar/policies/ (existing default-policy shape — Authz.Policy.Read
  is the closest analog)

Deliverable:
1. Append Dsl.Expression.{Read,List,Validate} to the manifest.
2. Default Cedar policies permitting `admin` role on the three actions;
   denying everything else.
3. routes/dsl.ts update — each handler calls evaluateRead() before
   touching the store. Denied requests return 403 POLICY_DENIED
   (no leak of artifact existence — do not check the store first).
4. Smoke-test: curl with `X-Debug-Principal: user:dev-admin:dev-tenant:admin`
   succeeds; curl with `:non-admin` returns 403.

Adversarial check: the validate endpoint is the most subtle case. A
denied request must NOT parse the source — even parsing is a tiny side
effect (CPU, error messages, log lines). The evaluate() call has to
short-circuit before validateDslSource() runs.
```

## Notes / log

- 2026-05-21: created. Standing follow-up from slice #5a where the
  policy check was deliberately skipped (the actions weren't registered).
  Slice #5b registered Dsl.Expression.Update; this ticket registers
  the read/list/validate triple and wires the gate.
