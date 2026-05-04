# `/adapters` — Port Implementations

Each adapter package implements one or more interfaces from
[`/ports`](../ports/CLAUDE.md). Adapters are the only place that touches real
infrastructure (Postgres, IndexedDB, Cedar WASM, etc.). Modules never import
adapter packages directly — apps wire concrete adapters at boot.

## Inventory

| Adapter | Package | Implements | Use |
|---------|---------|------------|-----|
| **`node/`** | `@atlas/adapter-node` | EventStore, Cache, ProjectionStore, SearchEngine, ControlPlaneRegistry, CatalogStateStore, RenderTreeStore, AnalyticsStore | Production server (Postgres-backed, multi-tenant) |
| **`idb/`** | `@atlas/adapter-idb` | EventStore, Cache, ProjectionStore, SearchEngine, ControlPlaneRegistry, CatalogStateStore, RenderTreeStore | Browser / sim runtime (IndexedDB) |
| **`policy-cedar/`** | `@atlas/adapter-policy-cedar` | PolicyEngine | Cedar policy engine — production authz |
| **`policy-stub/`** | `@atlas/adapter-policy-stub` | PolicyEngine | Allow-all stub for tests + dev defaults |

`node` and `idb` are mirrors of one another — both pass the same suites in
`@atlas/contract-tests`. This is what unlocks the parity tests in `tests/parity/`.

## Per-adapter Quick Map

### `@atlas/adapter-node`
- Entry: `src/index.ts` — exports every `Postgres*` class
- Migrations: `src/migrations/runner.ts` (also exported via `./migrations` subpath)
- Multi-tenancy: `src/tenant-db-provider.ts` — LRU pool, resolves tenant → connection
- Per-port impls: `event-store.ts`, `cache.ts`, `projection-store.ts`, `search-engine.ts`, `control-plane-registry.ts`, `catalog-state-store.ts`, `render-tree-store.ts`
- Migration files: `src/migrations/{control-plane,tenant}/*.sql`
- Bootstrap: `src/migrations/seed.ts` seeds the control-plane

### `@atlas/adapter-idb`
- Entry: `src/index.ts` — exports every `Idb*` class
- Setup: `src/db.ts` — `IdbDb` factory with versioned object stores
- Per-port impls: same filenames as node, prefixed `Idb*`
- Tests share the contract suite with node — keep parity when changing either

### `@atlas/adapter-policy-cedar`
- Entry: `src/index.ts` — `CedarPolicyEngine` is the main export
- Engine: `src/cedar-policy-engine.ts` (Cedar WASM bridge)
- Bundle loaders: `src/bundle-loader.ts` (fixture + Postgres sources)
- Schema: `src/schema-generator.ts` (action manifest → Cedar schema)
- Audit: `src/audit-emitter.ts` (decision logging)
- Cache invalidation: `src/cache-invalidation.ts`
- CLI: `bin/cedar-check.ts` — schema validation tool (`pnpm cedar:check`)

### `@atlas/adapter-policy-stub`
- Entry: `src/index.ts` → `StubPolicyEngine`
- Single file: `src/stub-policy-engine.ts` — default-allow with a tenant-scope guard

## Conventions

- **Naming.** Class names = `<Adapter><Port>` — `PostgresEventStore`, `IdbCache`, `CedarPolicyEngine`, `StubPolicyEngine`.
- **One file per port.** Each port gets its own `<port>.ts` with a single export.
- **Tests colocated.** Per-adapter tests live in `test/` and pull contract suites from `@atlas/contract-tests`. Both `node` and `idb` should run the same tests for any port they share.
- **No cross-adapter imports.** Adapters never import each other. They depend on `@atlas/ports`, `@atlas/platform-core`, `@atlas/schemas`.
- **Lockstep migrations.** Postgres SQL in `node/src/migrations/` mirrors the legacy Rust migrations. When a column moves, both sides must update or the parity tests will diverge.

## Consumers

- `apps/server` — production wires `node` + (`policy-cedar` or `policy-stub` based on config)
- `tests/parity/` — uses `node` and `idb` as alternate factories to verify parity
- Browser apps don't import adapters directly; they go through `@atlas/api-client`

## Adding a New Adapter

1. New folder under `/adapters/<name>/`. `package.json` name = `@atlas/adapter-<name>`.
2. `src/index.ts` exports concrete classes; one file per port implemented.
3. Add the package to the relevant app's deps and wire it in that app's `bootstrap.ts`.
4. Add a contract-test factory in `@atlas/contract-tests` and ensure suites pass.
5. If the adapter supersedes an existing one, remove the old wiring rather than gating with a flag — see root CLAUDE.md on avoiding compat shims.
