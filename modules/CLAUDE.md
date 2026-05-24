# `/modules` — Domain Modules

Pure-domain logic. Each module owns a bounded slice of platform behavior:
intent handlers, event-driven projections, queries, and the types that bind
them. Modules depend on [`/ports`](../ports/CLAUDE.md) and `@atlas/platform-core`
— never on adapters or HTTP.

> Apps wire modules to adapters at boot. The same module runs against Postgres
> on the server and IndexedDB in the browser sim.

## Inventory

| Module | Package | What it owns |
|--------|---------|--------------|
| `authz/` | `@atlas/authz` | Policy CRUD (draft / active / archived), Cedar bundle integration |
| `catalog/` | `@atlas/catalog` | Taxonomies, families, variants, attributes, search, seed-package import |
| `content-pages/` | `@atlas/content-pages` | Page CRUD + render-tree projection |
| `identity/` | `@atlas/identity` | Users, memberships, invites, sessions, MFA, SAML/OIDC, impersonation, break-glass, audit export, role packs |

The remaining business domains listed in the root `specs/domains/` map have no
domain code yet — `specs/` is the source of truth until they land here.

## Standard Module Skeleton

```
modules/<name>/
  src/
    index.ts            internal entry point — package consumers (apps, tests)
    types.ts            domain types (PageDocument, PolicySummary, …)
    errors.ts           <Module>Error class + error-code constants
    handlers/           one file per intent handler + a registry export
    projections/        event → read-model rebuilders
    queries/            read-side query functions
    queries.ts          (or queries/ folder when more than 2)
    dispatch.ts         event-to-projection wiring (EventDispatcher factory)
    public/             OPTIONAL — curated surface for OTHER MODULES only
      index.ts          re-exports the minimal API other modules may import
                        (default to events/projections instead; only add
                        files here when sync cross-module access is required)
```

Not every module has every directory — `authz` and `identity` have no
`projections/` folder (they project directly through entity wrappers),
`catalog` adds `seed-types.ts` and `responses.ts`, `identity` adds
top-level `crypto/`, `entities/`, `policies/`, `risk/`, `saml/`,
`audit-export.ts`, `audit-retention.ts`, and `session-lifetime.ts`. But
the shape is consistent.

## What Each Module Exports

| Module | Public surface (from `src/index.ts`) |
|--------|--------------------------------------|
| **authz** | Types (`PolicyStatus`, `PolicySummary`, `PolicyDetail`, `PolicyStore` interface), handlers (`handleCreatePolicy`, `handleActivatePolicy`, `handleArchivePolicy`), `authzHandlerRegistry`, `composeRegistries`, `AuthzError` (`PolicyStore` is implemented in `@atlas/adapter-node`, not exported from this module) |
| **catalog** | ID helpers, seed types (`SeedPayload`, `SeedFamily`, …), response types, handlers (`handleSeedPackageApply`, `handleFamilyPublish`, `catalogHandlerRegistry`), projections (`rebuildTaxonomyNavigation`, …), queries (`queryTaxonomyNodes`, `searchCatalog`, …), `catalogDispatcher`, `CatalogError` |
| **content-pages** | ID helpers, types (`PageDocument`, `RenderNode`, `RenderTree`, `PageStatus`), handlers (`handlePageCreate/Update/Delete`, `contentPagesHandlerRegistry`), projections (`buildRenderTree`, `rebuildRenderTree`, `upsertPageInList`, …), queries (`listPages`, `getPage`, `getRenderTree`), `contentPagesDispatcher`, `ContentPagesError` |
| **identity** | ID helpers, entity types + wrappers (User, Membership, InviteToken, AuthSession, ApiKey, ServicePrincipal, OAuthToken, IdentityProvider, ScimToken, AuditExportConfig/Run, AuthFactor + TOTP/WebAuthn/RecoveryCode/MfaBypass, SamlSpKey + replay, ImpersonationSession, BreakGlassGrant), handlers (user/membership/invite/password/session/api-key/service-principal/oauth/idp/jit/saml/totp/webauthn/recovery/mfa-bypass/scim-token/audit-export/impersonation/break-glass), `identityHandlerRegistry`, queries (`getUser`, `listMemberships`, `getSession`, …), risk + step-up helpers, audit-export pipeline, retention helpers, crypto helpers (`hashPassword`, `generateSecret`, TOTP), role-pack policy builders, `identityDispatcher`, `IdentityError` |

## How modules participate in the request lifecycle

A module owns the *handler → event → projection → cache* slice for its
domain. The full end-to-end trace (frontend through ingress through
dispatcher chain back to frontend reads) lives at
[`specs/lifecycle.md`](../specs/lifecycle.md). Read that if you're new to
how a module's handlers and dispatchers fit together.

Inside the request:

- The handler runs (after authz). Emits a primary event + optional follow-ups.
- Events are appended to the `EventStore`, which is the worker's durable feed.
- The dispatcher chain — each module dispatcher rebuilding its projections, then `cacheTagDispatcher(cache)` clearing entries by tag, then SSE broadcast — runs against those events.

**The chain runs in one of two places** depending on `WORKER_MODE`: inline (default) in `apps/server/src/middleware/state.ts`, or async in `apps/projection-worker/src/tenant-loop.ts`. The two compositions are intentionally mirrored — when adding or modifying a module dispatcher, update both locations. (As of this writing the worker mirrors catalog + content-pages but not identity; verify the worker's chain when adding identity-driven projections.) Full design: [`specs/worker.md`](../specs/worker.md).

## Cache invalidation contract

Every event a handler emits MUST include `cacheInvalidationTags`. Tags are
**handwritten** — there is no automatic derivation from event type or
resource. Forgetting the tags silently leaves stale cache (Invariant **I10**
violation).

Conventions:

- Always include `Tenant:${tenantId}` so tenant-wide invalidation works.
- Add per-resource tags as `<Resource>:<id>`. Examples from the codebase:
  - `['Tenant:t1', 'Page:welcome']` (`modules/content-pages/src/handlers/page-create.ts:71`)
  - `['Tenant:${cmd.tenantId}']` for tenant-wide ops (`modules/authz/src/handlers/activate-policy.ts:45`)
- Tag strings must match the prefix the cache layer will purge. The cache
  treats tags as opaque strings — there's no schema. Just be consistent
  across emit sites and across tests.

If your handler updates a projection but doesn't tag the event, queries will
read stale data. Catch this in `modules/<x>/test/handlers.test.ts` by
asserting `envelope.cacheInvalidationTags` for every test case.

## Conventions

- **Handler pattern.** Each handler takes `(IntentHandlerContext, IntentEnvelope)` and emits a primary event plus optional follow-ups. Registries map `actionId` (e.g. `Authz.Policy.Create`) → handler. Apps compose registries via `composeRegistries`.
- **Dispatcher pattern.** Each module exports a dispatcher factory. Apps fold module dispatchers through `composeDispatchers` from `@atlas/ports`. Events arrive as `EventEnvelope`; the dispatcher fans out to projections.
- **Errors.** One `<Module>Error` class per module with a `code: string` field. Error-code strings are listed in `errors.ts` and referenced by status-code-aware constructors; the canonical taxonomy lives in `specs/crosscut/errors.md` and `specs/error_taxonomy.json`.
- **Payload validation helpers.** Tiny readers (`readString`, `readNumber`, `readOptionalString`) are duplicated per module — keep them; do not abstract.
- **Query façades.** When a module exposes more than a handful of read paths, a `query-router.ts` (or top-level `queries.ts`) bundles a `QueryDeps` type. Apps build that bundle per request, including tenant-scoped adapters.
- **No I/O imports.** Modules import only from `@atlas/ports`, `@atlas/platform-core`, and standard libs. Reaching for an adapter package from inside a module is a bug.
- **No cross-module imports.** A module under `/modules` may not import another module's internals. Cross-domain reads go through events/projections (I12). When sync access is genuinely unavoidable, the producing module exposes a curated surface in `src/public/index.ts` and the consumer imports `from '@atlas/<other>/public'`. Enforced by `pnpm deps:check` (dep-cruiser, `no-cross-module-internals`). A grep for `'@atlas/<x>/public'` then lists every consumer of `<x>` — useful the day you extract it as a service.
- **Seed schemas.** `seed-types.ts` (catalog) defines bulk-import shapes shared with the schema validator. Keep these in lock-step with `packages/schemas`.

## Dependency Map

| Module | `@atlas/ports` | `@atlas/platform-core` |
|--------|----------------|------------------------|
| authz | HandlerRegistry, IntentHandler, IntentHandlerContext | EventEnvelope, IntentEnvelope |
| catalog | CatalogStateStore, ProjectionStore, SearchEngine, EventDispatcher, Cache | EventEnvelope, SearchDocument |
| content-pages | ProjectionStore, RenderTreeStore, WasmHost, EventDispatcher, EventStore | EventEnvelope |
| identity | EntityStore, RelationStore, EventStore, Cache, HandlerRegistry, IntentHandlerContext | EventEnvelope, IntentEnvelope |

## Consumers

`apps/server` is the primary consumer:

- `routes/catalog.ts` — catalog query endpoints
- `routes/content-pages.ts` — page query endpoints
- `routes/authz.ts` — policy listing
- `routes/identity.ts`, `routes/identity-a7.ts`, `routes/identity-idp.ts`, `routes/mfa.ts`, `routes/oauth.ts`, `routes/saml.ts`, `routes/scim.ts` — identity-flow endpoints (most identity intents go through `routes/intents.ts`)
- `middleware/state.ts` — composes all four module handler registries + dispatchers (the projection-worker's `tenant-loop.ts` mirrors only catalog + content-pages today)

## Adding a New Module

1. Create `modules/<name>/` with the standard skeleton.
2. Define `<Name>Error` with the same shape as `AuthzError` etc.
3. Export a handler registry (even if there's only one handler) and a dispatcher (even if it's a no-op for now).
4. Add the package to `apps/server` deps and wire it in `middleware/state.ts`.
5. Add a `dispatch.ts` test that asserts the projection set rebuilds correctly from a synthetic event stream — this is how Invariant I12 (rebuildable projections) is enforced.
