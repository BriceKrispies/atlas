# `/ports` — `@atlas/ports`

Single package. Interface-only — no implementations. Every infrastructure
capability the platform consumes is defined here as a TypeScript type, then
implemented by an `/adapters/*` package.

> **Rule of thumb:** if it touches I/O (DB, cache, network, filesystem, plugin
> sandbox), it goes through a port. Modules and apps depend on ports, not on
> adapter packages directly.

## Port Catalogue

| Port | File | Purpose |
|------|------|---------|
| `EventStore` | `event-store.ts` | Append/read immutable event envelopes |
| `AnalyticsStore` | `analytics-store.ts` | Tenant-scoped analytics events |
| `Cache` | `cache.ts` | KV with tag-based invalidation (Invariant I10) |
| `ProjectionStore` | `projection-store.ts` | KV for materialized read models |
| `SearchEngine` | `search-engine.ts` | Tenant-isolated full-text index/query (I7) |
| `ControlPlaneRegistry` | `control-plane-registry.ts` | Action schemas + validation registry |
| `CatalogStateStore` | `catalog-state-store.ts` | Durable tenant seed-package state |
| `CustomDomainStore` | `custom-domain-store.ts` | Tenant custom-domain bindings |
| `EntityStore` | `entity-store.ts` | Generic typed-entity persistence |
| `EntityTypeRegistry` | `entity-type-registry.ts` | Registered entity types + schemas |
| `RelationStore` | `relation-store.ts` | Typed relations between entities |
| `WorkerSource` | `worker-source.ts` | Event/work feed for projection workers |
| `HandlerRegistry` | `handler-registry.ts` | Intent-handler dispatch registry |
| `PolicyEngine` | `policy-engine.ts` | Authorization decisions (permit/deny, I4) |
| `EventDispatcher` | `dispatcher.ts` | Event-handling composition closure (see [`specs/lifecycle.md`](../specs/lifecycle.md) for usage in context) |
| `Mailer` | `mailer.ts` | Outbound email delivery (magic links, notifications) |
| `WasmHost` / `WasmPluginLoader` | `wasm-host.ts` | Sandboxed plugin execution |
| `SeedCorpus` | `seed-corpus.ts` | Operator/SDET-scoped library of scenarios + fixtures (memory/fs/sqlite) |

The full surface is re-exported from `src/index.ts`. Read it first when picking
the port a feature depends on.

### Helpers exported alongside types

- `composeDispatchers(...dispatchers)` — fan a single event to many handlers
- `cacheTagDispatcher(cache)` — turn `cacheInvalidationTags` into purges (Invariant I10). Wired in `apps/server/src/middleware/state.ts`; full flow in [`specs/lifecycle.md`](../specs/lifecycle.md).
- `InMemoryAnalyticsStore` — concrete impl, fine for tests/dev only

## Conventions

- **File-per-port.** One TS file per interface. Suffix indicates shape: `*Store`, `*Engine`, `*Registry`, `*Host`, `*Dispatcher`.
- **Types-only.** No runtime classes except the trivial in-memory analytics store and the dispatcher composition helpers.
- **Tenant scoping.** Any port that reads or writes data takes `tenantId` (or scoped equivalent) in its method signatures — this is how Invariants I7 and I9 are enforced at the type level.
- **No domain types.** Domain shapes (`EventEnvelope`, `IntentEnvelope`, `SearchDocument`) live in `@atlas/platform-core` and are imported here.

## Implementer ↔ Consumer Map

| Port | Implemented by | Consumed by |
|------|----------------|-------------|
| EventStore, Cache, ProjectionStore, SearchEngine, CatalogStateStore, EntityStore, RelationStore, WorkerSource | `@atlas/adapter-node` (Postgres), `@atlas/adapter-idb` (IndexedDB) | `apps/server`, `modules/*` |
| ControlPlaneRegistry | `@atlas/adapter-node` (Postgres); in-memory fallback in `@atlas/adapter-idb` | `apps/server`, `modules/*` |
| CustomDomainStore, EntityTypeRegistry | `@atlas/adapter-node` (Postgres) | `apps/server`, `modules/*` |
| PolicyEngine | `@atlas/adapter-policy-cedar`, `@atlas/adapter-policy-stub` | `apps/server` (bootstrap), `packages/ingress` |
| WasmHost | `@atlas/wasm-host` (browser + node) | `modules/content-pages`, `apps/server` |
| HandlerRegistry, EventDispatcher | composed in modules and wired in apps | `apps/server`, `packages/ingress` |
| Mailer | `@atlas/adapter-node` (StdoutEventMailer for dev/sim, SmtpMailer for SMTP relay). **Server-only** — no IDB counterpart (sim doesn't send mail). | `apps/server` (signup-approve, future identity flows) |
| AnalyticsStore | `InMemoryAnalyticsStore` exported from `@atlas/ports` (no adapter-backed impl yet) | `apps/server` |

For adapter details see [`adapters/CLAUDE.md`](../adapters/CLAUDE.md).

## Adding a Port

1. Decide whether the capability is genuinely new — most needs fit an existing port.
2. Add `<name>.ts` defining the interface; export only types.
3. Re-export from `src/index.ts`.
4. Add an in-memory or stub implementation in the adapter that owns this concern (or in `@atlas/contract-tests` if the port is used widely).
5. Update each adapter that should support it; failures here surface in `@atlas/contract-tests`.

## Contract Tests

Cross-adapter parity lives in `packages/contract-tests`. When you add a port
method, add (or extend) the suite for that port — both `node` and `idb` adapters
should pass the same tests.
