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

The 8 spec-only modules listed in `specs/` (tokens, comms, org, content,
points, audit, import, badges) have no domain code yet — `specs/` is the source
of truth until they land here.

## Standard Module Skeleton

```
modules/<name>/
  src/
    index.ts            re-exports the public surface
    types.ts            domain types (PageDocument, PolicySummary, …)
    errors.ts           <Module>Error class + error-code constants
    handlers/           one file per intent handler + a registry export
    projections/        event → read-model rebuilders
    queries/            read-side query functions
    queries.ts          (or queries/ folder when more than 2)
    dispatch.ts         event-to-projection wiring (EventDispatcher factory)
```

Not every module has every directory — `authz` has no projections, `catalog`
adds `seed-types.ts` and `responses.ts`. But the shape is consistent.

## What Each Module Exports

| Module | Public surface (from `src/index.ts`) |
|--------|--------------------------------------|
| **authz** | Types (`PolicyStatus`, `PolicySummary`, `PolicyDetail`, store interfaces), handlers (`handleCreatePolicy`, `handleActivatePolicy`, `handleArchivePolicy`), `authzHandlerRegistry`, `composeRegistries`, `PostgresPolicyStore`, `AuthzError` |
| **catalog** | ID helpers, seed types (`SeedPayload`, `SeedFamily`, …), response types, handlers (`handleSeedPackageApply`, `handleFamilyPublish`, `catalogHandlerRegistry`), projections (`rebuildTaxonomyNavigation`, …), queries (`queryTaxonomyNodes`, `searchCatalog`, …), `catalogDispatcher`, `CatalogError` |
| **content-pages** | ID helpers, types (`PageDocument`, `RenderNode`, `RenderTree`, `PageStatus`), handlers (`handlePageCreate/Update/Delete`, `contentPagesHandlerRegistry`), projections (`buildRenderTree`, `rebuildRenderTree`, `upsertPageInList`, …), queries (`listPages`, `getPage`, `getRenderTree`), `contentPagesDispatcher`, `ContentPagesError` |

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

**The chain runs in one of two places** depending on `WORKER_MODE`: inline (default) in `apps/server/src/middleware/state.ts`, or async in `apps/projection-worker/src/tenant-loop.ts`. The composition is identical — when adding or modifying a module dispatcher, update both locations. Full design: [`specs/worker.md`](../specs/worker.md).

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
- **Seed schemas.** `seed-types.ts` (catalog) defines bulk-import shapes shared with the schema validator. Keep these in lock-step with `packages/schemas`.

## Dependency Map

| Module | `@atlas/ports` | `@atlas/platform-core` |
|--------|----------------|------------------------|
| authz | HandlerRegistry, IntentHandler, IntentHandlerContext | EventEnvelope, IntentEnvelope |
| catalog | CatalogStateStore, ProjectionStore, SearchEngine, EventDispatcher, Cache | EventEnvelope, SearchDocument |
| content-pages | ProjectionStore, RenderTreeStore, WasmHost, EventDispatcher, EventStore | EventEnvelope |

## Consumers

`apps/server` is the primary consumer:

- `routes/catalog.ts` — catalog query endpoints
- `routes/content-pages.ts` — page query endpoints
- `routes/authz.ts` — policy listing
- `middleware/state.ts` — composes all three handler registries + dispatchers

## Adding a New Module

1. Create `modules/<name>/` with the standard skeleton.
2. Define `<Name>Error` with the same shape as `AuthzError` etc.
3. Export a handler registry (even if there's only one handler) and a dispatcher (even if it's a no-op for now).
4. Add the package to `apps/server` deps and wire it in `middleware/state.ts`.
5. Add a `dispatch.ts` test that asserts the projection set rebuilds correctly from a synthetic event stream — this is how Invariant I12 (rebuildable projections) is enforced.
