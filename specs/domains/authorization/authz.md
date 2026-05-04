# Authorization

This document describes the **implemented** authorization system. Code is
TypeScript; the legacy Rust prototype was deleted on 2026-05-04.

## Invariants

**I2 — Authorization Before Execution.** Every non-public ingress
request performs a primary authorization decision before handler
dispatch. No domain logic runs until authz allows.

**I4 — Deny-Overrides-Allow.** Any DENY rule overrides all ALLOW rules.
With no policies matching, the default decision is DENY. Cedar enforces
this natively.

**I9 — Tenant in scope.** Authorization decisions use the canonical
`tenantId` from the authenticated `Principal`. Request payloads cannot
override it.

## Authorization Model

The platform uses **Cedar** (`@cedar-policy/cedar-wasm`) as the policy
engine in production. A stub engine (`adapters/policy-stub`) is used in
tests/dev to exercise the path with allow-all or deny-all decisions.

| Layer | Code |
|---|---|
| Port interface | `ports/src/policy-engine.ts` |
| Cedar adapter | `adapters/policy-cedar/src/` |
| Stub adapter | `adapters/policy-stub/src/` |
| Policy CRUD module | `modules/authz/src/` |
| Per-request enforcement | `packages/ingress/src/submit-intent.ts:186-306` |

The `POLICY_ENGINE` env var (`cedar` | `stub`) selects which adapter
boots in `apps/server/src/bootstrap.ts`.

## Action / Resource Model

Actions and resources are derived from the intent payload — not
hardcoded. Each module declares its actions in its handler registry.

**`actionId`** — `<Module>.<Resource>.<Verb>` or `<Module>.<Verb>`. For
example, `Identity.AuthSession.Issue`, `ContentPages.Page.Create`.

**`resourceType`** + optional **`resourceId`** — taken from the intent
envelope so policies can target specific resources.

Validation rules:
- `actionId` ≥ 2 dot-separated segments; alphanumeric + underscore.
- `resourceType` required, alphanumeric.
- `resourceId` optional (absent for create operations).

## Policy Storage

`modules/authz/src/policy-store.ts`:

```ts
export type PolicyStatus = 'draft' | 'active' | 'archived';

export interface PolicySummary {
  tenantId: string;
  version: number;
  status: PolicyStatus;
  // ... created/lastModified metadata
}

export interface PolicyDetail extends PolicySummary {
  cedarText: string;
}

export interface PolicyStore {
  list(tenantId: string): Promise<readonly PolicySummary[]>;
  get(tenantId: string, version: number): Promise<PolicyDetail | null>;
  // create-as-draft / activate / archive
}
```

The Postgres implementation is `modules/authz/src/postgres-policy-store.ts`.
Each tenant has at most one `active` row; activating a new version
archives the previous one in the same transaction.

## Lifecycle Handlers

Registered via `authzHandlerRegistry`:

| Action | Handler |
|---|---|
| `Authz.Policy.Create` | `handlers/create-policy.ts` (status: draft) |
| `Authz.Policy.Activate` | `handlers/activate-policy.ts` |
| `Authz.Policy.Archive` | `handlers/archive-policy.ts` |

Activation invalidates the per-tenant policy cache (`Tenant:<id>` cache
tag, I10) so the next `submitIntent` reloads the bundle.

## Enforcement Flow

```
POST /api/v1/intents
  └─ apps/server/src/index.ts → routes/intents.ts
  └─ packages/ingress/src/submit-intent.ts
       1. envelope shape + correlation id
       2. principal already on context (principalMiddleware)
       3. tenantId from principal == envelope.tenantId  (I9)
       4. idempotency key non-empty  (I3 — full lookup in A2-hardening)
       5. schema validation
       6. PolicyEngine.evaluate({
            principal, action: envelope.payload.actionId,
            resource: { type, id }, environment: { tenantId, occurredAt }
          })
          → DENY → 403, log, return
          → ALLOW → 7
       7. Handler dispatch (modules/<x>/src/handlers/registry.ts)
```

Anchoring lines: tenant-match check at
`packages/ingress/src/submit-intent.ts:149`; authz block at
`packages/ingress/src/submit-intent.ts:186-306`; handler dispatch at
`:309`.

## Principal Attributes Available to Policies

The `Principal` is defined in
`packages/platform-core/src/types.ts`:

```ts
export interface Principal {
  principalId: string;
  tenantId: string;
  userId?: string;
  attributes?: Record<string, unknown>;
}
```

The Cedar adapter projects this into the standard ABAC shape:
`{ principal: { id, tenantId, ...attributes }, action, resource:
{ type, id }, context: { tenantId, occurredAt } }`. Custom claims and
scheme-specific fields (`sessionId`, `apiKeyId`, `scopes`,
`oauthTokenId`) ride on `attributes`.

## Tenant Handling

1. `tenantId` is set on the `Principal` during authentication.
2. `submitIntent` rejects requests whose envelope `tenantId` does not
   match the `Principal.tenantId`.
3. The Cedar adapter's `context.tenantId` always equals the
   `Principal.tenantId`.
4. Mismatch → `403`, code `PRINCIPAL_INVALID`.

## Error Model

| Error | HTTP | Code |
|---|---|---|
| Missing actionId / resourceType | 400 | `INTENT_INVALID` |
| Bad actionId / resourceType format | 400 | `INTENT_INVALID` |
| Authorization denied | 403 | `AUTHZ_DENIED` |
| Tenant mismatch | 403 | `PRINCIPAL_INVALID` |

Error responses do not leak Cedar internals. Internal denial reasons
(matched rules, policy IDs) are logged but not returned.

## Logging & Metrics

**Denial (INFO):** `actionId`, `resourceType`, `resourceId`, `principalId`,
`tenantId`, `correlationId`, denial reason, matched rule IDs.

**Metric:** `authz_decisions_total{decision="allow|deny", action=…}`.

## Permission and Role Model (Identity ↔ Authz integration)

`modules/identity/src/policies/role-packs.ts` exports the
platform-default Cedar bundle (`buildRolePackBundle`). Roles are simply
permission bundles:

```ts
{
  "Tenant Admin": ["*"],
  "Editor": ["ContentPages.*", "Catalog.Page.Read"],
  // ...
}
```

When a user logs in, `Membership.roles` are hydrated into
`Principal.attributes.roles`. Cedar policies match on roles directly;
the role pack is loaded as part of the per-tenant bundle.

Per-tenant custom roles atop the platform defaults are an A4-phase
deliverable.

## Effective-Permissions Cache

Cedar evaluates the policy set on every request, but the *bundle* is
cached per-tenant:

- Cache key: `authz:bundle:<tenantId>` (I9 — tenant in key).
- Invalidation: event-driven via tags (I10) — `Authz.Policy.Activated`
  emits `cacheInvalidationTags: ['Tenant:<id>', 'AuthzBundle:<id>']`.

Per-user effective permissions are not separately cached today; they
ride on the principal attributes that policy evaluation reads each
request. If profiling shows hot-path cost, a per-user permission
projection is the obvious next step.

## Configuration

| Env var | Purpose |
|---|---|
| `POLICY_ENGINE` | `cedar` or `stub` |
| `POLICY_DEFAULT_ALLOW_ALL` | Dev-only override; never set in prod |

## Open Questions

- Action-registry validation. Today the registry is implicit (the
  handler entries in each module's `registry.ts` define what's
  callable); a manifest-level registry that ingress can validate
  against pre-dispatch is on the spec backlog.
- Per-tenant role packs (custom roles atop platform defaults) — A4.
- Feature-gate API ("can principal P do action A?") for UI gating.
