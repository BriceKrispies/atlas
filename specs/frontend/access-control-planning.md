# Access Control UI — Planning Notes

Status: **planning**, pre-contract. Not a normative spec. Once scope is
confirmed and design calls are answered, surface contracts go under
`frontend/apps/admin/src/features/access/<feature>/contracts/`.

## What's already in the platform

The Atlas authorization story is **ABAC** (attribute-based, deny-overrides-allow,
default-deny). RBAC is layered on top via the identity entities. This UI has to
respect that split — presenting it as a pure RBAC matrix would drift from how
the engine actually decides.

### References (read these before drafting contracts)

| File | What it covers |
|------|----------------|
| `specs/architecture.md` | Invariants I2 (authz before execution), I4 (deny-overrides-allow), I5 (canonical tenant) |
| `specs/crosscut/authz.md` | Implemented engine: PolicyEvaluationContext, evaluation flow, error model, future Cedar migration |
| `specs/crosscut/identity.md` | User entity, Principal vs User, lifecycle |
| `specs/schemas/identity.md` | Permission, Role, RolePermission, UserRole, UserProfile entities |
| `crates/core/src/policy.rs` | Policy engine implementation |
| `crates/ingress/src/authz.rs` | Enforcement point — IntentAuthzRequest extraction |

### The three layers

1. **Permission catalog** — global, immutable. `code` follows
   `{module}.{resource}.{verb}` (e.g., `content.pages.create`). Same
   namespace as `actionId` in intent payloads. Modules declare
   permissions in their manifests; tenants cannot create or edit them.
   Lifecycle: `active` / `deprecated` (never deleted).

2. **RBAC** — tenant-scoped. `Role` (tenant-named bundle), `RolePermission`
   (compose), `UserRole` (assign, optional `expires_at`). System roles
   `Tenant Admin` and `User` exist by default per tenant; tenants can
   customize their permissions but not delete them.

3. **ABAC policies** — separate from RBAC. Condition trees over
   `principal_attributes` / `resource_attributes` / `environment_attributes`
   with `Allow`/`Deny` effect. Roles fold in because effective permissions
   land in `principal_attributes.permissions` at evaluation time. The
   *common-case* policy is just "does the principal's permission list
   contain `action_id`"; fine-grained / contextual rules ("editor can
   edit pages only in their own department") live as policies on top.

### Engine open question we should drive

`crosscut/authz.md` open questions list:

> Should there be a "capability check" API endpoint (given user X, can
> they do action Y?) for UI feature gating?

Yes — the **explainer / simulator** surface below depends on this. We
should land this endpoint as a prerequisite (or in lockstep).

## Recommended surface set

### v1 — RBAC core + the explainer

| `surfaceId` | Purpose |
|---|---|
| `admin.access.roles-list` | Browse tenant roles. Columns: name, # perms, # users assigned, system flag, status. |
| `admin.access.role-editor` | Compose a role from the permission catalog (grouped by module, only modules enabled for the tenant). Show "this role currently affects N users." |
| `admin.access.users-roles` | Per-user role assignments + expiries. Bulk assign / revoke. |
| `admin.access.access-explainer` | Pick principal + action + (optional) resource → show decision, matched rules, effective permission set, denial reason. Supports diff mode: "if I add perm X to role Y, what changes?" |

### v2 — ABAC layer

| `surfaceId` | Purpose |
|---|---|
| `admin.access.policies-list` | Browse policies, filter by what they touch. |
| `admin.access.policy-editor` | Edit a policy. JSON view via `atlas-code-editor` with schema validation in v2; visual condition builder in v3 once we know which condition shapes people actually use. |
| `admin.access.permission-catalog` | Read-only catalog grouped by module — for browsing, finding `code` strings. |

### Widgets (small, embeddable on dashboards)

- `widget.access.your-roles` — current user's assigned roles + expiries.
- `widget.access.recent-denials` — top denials from the last 24h with
  action / resource / principal. Click-through opens `access-explainer`
  pre-filled.

## Design calls — need answers before drafting contracts

1. **Visual condition builder vs. JSON-only for policies in v2?**
   - JSON-only (atlas-code-editor + schema): ships v2 faster, raises
     authoring floor.
   - Visual (atlas-tree + condition primitive palette): real engineering
     effort.
   - **Recommended:** JSON-only in v2, visual builder in v3.

2. **Where does the explainer live — standalone surface or embedded
   panel inside role-editor / policy-editor?**
   - **Recommended:** standalone surface (so audits and on-call can hit
     it without editor context) **plus** an embedded preview mode in
     the editors that opens the standalone explainer pre-filled.

3. **Expiry granularity on `UserRole.expires_at`** — picker resolution
   (minute / hour / day)? Default duration on temporary admin grants?

4. **Permission catalog scoping** — show only permissions for modules
   enabled for this tenant, or show all and disable / grey unavailable
   ones?
   - **Recommended:** only enabled, with a "+ enable a module" link
     out to the module-enablement surface.

## Engineering notes

### a11y / UX

- Role editor and policy editor are high-stakes — both need the **C4
  required states** with extra care for `validationError` (overlapping
  rules, deprecated permissions still in use) and `backendError` (race
  on concurrent edit).
- Diff mode in the explainer needs `<atlas-diff>` (already shipped in
  batch 8) for the before/after comparison.
- The explainer's evaluation trace renders well with `<atlas-tree>` (also
  shipped in batch 6) — each node is a condition, leaves are attribute
  lookups.
- Permission catalog grouping by module is ideal for `<atlas-accordion>`
  with `type="multiple"`.
- Mobile-first matters: tenant admins do triage from phones. Role
  editor's permission picker should fall back to a search-then-pick
  flow under `--atlas-bp-md`, not a wide grid.

### Cross-cutting

- Cache invalidation: per `crosscut/authz.md`, mutations to
  `RolePermission` invalidate **all users with that role**; `UserRole`
  changes invalidate the affected user. The UI must surface this so
  admins understand "saving this role will recompute access for 47
  users." Render the count before commit.
- Telemetry events follow C5: `admin.access.roles-list.create-clicked`,
  `admin.access.role-editor.permission-toggled`,
  `admin.access.access-explainer.simulation-run`, etc.
- All mutations go through `@atlas/api-client` with `correlationId`
  generated client-side (C6) and propagated into the audit log.

## Suggested next step

1. Confirm v1 scope (4 surfaces) and answer the 4 design calls.
2. Driver: get the "capability check" engine endpoint specced and
   built. The explainer surface needs it.
3. Draft surface contracts under
   `frontend/apps/admin/src/features/access/<feature>/contracts/` per
   the C1 / C10 workflow. Contracts first, then Playwright tests, then
   implementation. No implementation until the contracts are reviewed.

## Conversation context

This file was extracted from a planning conversation. Key decisions
noted above are recommendations from that discussion, not approved
scope. The user flagged that ABAC must be in scope alongside RBAC
because the engine is ABAC-first.
