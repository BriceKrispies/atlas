---
title: admin-approve signup endpoint must call PostgresTenantDbProvider.provisionTenantDatabase
status: open
type: capability
owner: spine-owner
phase: 0
capability: specs/domains/tenancy/capabilities/public-signup/README.md
adr: specs/decisions/0005-custom-schema-storage-strategy.md
vision: [agentic-first, atlas-on-atlas]
invariants: [I1, I20]
blocks:
  - identity/tenant-admin-invites-user
  - tenancy/admin-approves-signup-bdd
blocked_by: []
files_in_scope:
  - apps/server/src/routes/signup.ts
  - adapters/node/src/tenant-db-provider.ts
  - modules/tenancy/src/handlers/signup-approve.ts
  - tests/bdd/features/tenancy/public-signup/admin-approves-signup.feature
  - tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature
acceptance:
  - admin-approve endpoint (`POST /api/v1/admin/signups/:id/approve`) calls `PostgresTenantDbProvider.provisionTenantDatabase(tenantId)` as part of the approval flow
  - after approve returns 200, `control_plane.tenants.db_*` columns are populated (no longer NULL) for the approved tenant
  - subsequent ingress requests on the approved tenant's slug do NOT fail with `TENANT_DATABASE_NOT_PROVISIONED`
  - per-tenant migrations run against the provisioned DB before the approve endpoint returns
  - existing `tenancy/public-signup` BDD scenario passes end-to-end (failure #3 from the 2026-05-22 BDD run)
  - new `identity/tenant-admin-invites-user` BDD scenarios pass end-to-end (failures #1 + #2 from the same run — both bottleneck on tenant `acme` being a real, provisioned tenant)
  - I20 demonstration finally executes: the tenant-admin-invites-user BDD reaches the I20 bootId-equality assertion in its final step
created: 2026-05-22
updated: 2026-05-23
---

## Why

Surfaced 2026-05-22 during the first attempt to run `identity/tenant-admin-invites-user`'s BDD scenario end-to-end against the real stack (after the atlas-doctor unblocker cleared the Windows podman / compose-provider issue). All three test failures from that run traced to a single root cause: **tenant `acme` doesn't exist as a provisioned tenant in `control_plane.tenants`** because the admin-approve endpoint never calls `PostgresTenantDbProvider.provisionTenantDatabase`.

Concrete trace (from `apps/server` structured logs, correlationId `test-deny-trace`):

```
Intent.Rejected {code: 'BUNDLE_BUILD_FAILED', reason: 'tenant acme: not found in control_plane.tenants'}
Ingress.UnmappedError {error: 'tenant acme: not found in control_plane.tenants',
  stack: 'PostgresTenantDbProvider.openPool (adapters/node/src/tenant-db-provider.ts:344) →
          ensureTenantMigrated (apps/server/src/bootstrap.ts:672) →
          _buildRequestBundleImpl (apps/server/src/middleware/state.ts:329) →
          routes/intents.ts:111'}
```

The pre-existing public-signup BDD has the same gap — its third failure on the same run:

```
approveSignup: expected 200, got 503
TENANT_DATABASE_NOT_PROVISIONED — tenant ...: per-tenant database not provisioned (control_plane.tenants.db_* is NULL).
In dev: run `pnpm dev:up` to provision the per-tenant DB.
In production: invoke the tenancy provisioner (PostgresTenantDbProvider.provisionTenantDatabase) during signup-approval.
See ADR 0005 (db-per-tenant).
```

The error message itself names the fix: admin-approve must invoke the provisioner. The code path exists (`adapters/node/src/tenant-db-provider.ts:provisionTenantDatabase`); it's just not wired into the signup-approve handler.

This is a real tenancy-platform gap. The capability `tenant-admin-invites-user` (and any future capability that consumes a per-tenant DB) cannot ship until this lands.

## Scope

In scope:

- Wire `PostgresTenantDbProvider.provisionTenantDatabase(tenantId)` into the signup-approve handler at `modules/tenancy/src/handlers/signup-approve.ts` (or the matching route handler at `apps/server/src/routes/signup.ts` — pick the right layer per the slice's hexagonal-boundary review).
- Ensure per-tenant migrations run against the newly-provisioned DB before approve returns. The provisioner currently does this internally; verify the wiring sequence does not race the first inbound request.
- Update `control_plane.tenants.db_*` columns synchronously with the provisioning so subsequent `bundle.openPool(tenantId)` calls find the DB record. Currently those columns stay NULL on a non-provisioned tenant — the surfaced error message specifically names this as the operator-facing signal.
- Both BDD scenarios (public-signup admin-approves-signup + identity tenant-admin-invites-user) become the executable witness.

Out of scope:

- Any change to the provisioner internals — `PostgresTenantDbProvider.provisionTenantDatabase` is correct as-is; only the wire-in is missing.
- Backfilling existing partially-provisioned tenant rows (none in dev).
- A separate dev-mode bulk-provisioner script (the existing `pnpm dev:up` covers that and remains the operator escape hatch).
- I20-related kernel-extraction questions — the admin-approve handler is platform code that needs to invoke a port; that's normal flow, not a kernel touch.

## Resume prompt

```text
Scope this slice with spine-owner. Read modules/tenancy/src/handlers/signup-approve.ts and apps/server/src/routes/signup.ts to find where the approve flow currently DOESN'T call provisionTenantDatabase. Decide whether the wire-in lands at the route or the handler layer (hexagonal review — the provider is a port; only adapter implementations live in apps/server; the handler should take the provider as a dep). Then dispatch module-dev to implement. Verify by running pnpm safe bdd:server (timeout 600000) — both the existing public-signup scenario and the new tenant-admin-invites-user scenario should pass end-to-end. Once they do, identity/tenant-admin-invites-user unblocks for its own sdet+architect gates and the first I20 demonstration finally ships.
```

## Notes / log

- 2026-05-22: filed by main after running the first BDD attempt end-to-end against the real stack and tracing three independent test failures to one platform gap. Both blocked tickets (this one and identity/tenant-admin-invites-user) wait on this slice landing.
- 2026-05-23: ticket-sweep — added `tenancy/admin-approves-signup-bdd` to `blocks` (mirror edge). That ticket's "public-signup admin-approves-signup" scenario is failure #3 from the 2026-05-22 run and cannot pass until this slice lands; it was moved to `blocked` in the same sweep.
