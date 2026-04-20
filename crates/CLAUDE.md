# Atlas Rust Workspace

## Architecture

Hexagonal (ports & adapters). Dependencies flow inward:

```
core (domain types, policy engine)
  └─► runtime (port traits — hexagonal interfaces)
        └─► adapters (in-memory + Postgres implementations)
              └─► ingress (HTTP gateway) + workers (background processor)
```

Full design: `specs/architecture.md`

## Crate Map

| Crate (package name) | Purpose | Key files |
|-----------------------|---------|-----------|
| `atlas-core` | Domain types, policy engine, validation, error taxonomy | `src/types.rs`, `src/policy.rs`, `src/validation.rs` |
| `atlas-platform-runtime` | Port traits (EventStore, Cache, ProjectionStore, SearchEngine) | `src/ports.rs` |
| `atlas-platform-adapters` | In-memory + Postgres implementations of ports | `src/memory.rs`, `src/postgres_registry.rs` |
| `atlas-platform-ingress` | HTTP gateway, single chokepoint (I1) — **see `ingress/CLAUDE.md`** | `src/main.rs`, `src/bootstrap.rs` |
| `atlas-platform-workers` | Background event processor binary | `src/main.rs` |
| `atlas-wasm-runtime` | WASM plugin sandbox (wasmtime, zero-authority) | `src/lib.rs`, `src/render_tree.rs` |
| `atlas-platform-control-plane-db` | Postgres migrations + seed data | `migrations/*.sql`, `src/bin/migrate.rs`, `src/bin/seed.rs` |
| `atlas-config` | Environment config (AtlasEnv: Dev/Strict) | `src/lib.rs` |
| `atlas-diagnostics` | Logging, tracing, metrics setup | `src/lib.rs` |
| `atlas-platform-spec-validate` | Golden fixture validator | `src/main.rs` |
| `atlas-compiler` | Spec compiler (empty stub) | — |
| `atlasctl` | Operator CLI (stub) | `src/main.rs` |

## Where to Make Changes

| Task | Where |
|------|-------|
| Add/change domain type | `core/src/types.rs` |
| Add/change error variant | `core/src/lib.rs` (error taxonomy codes) |
| Add/change policy evaluation | `core/src/policy.rs` |
| Add/change port trait | `runtime/src/ports.rs` |
| Add in-memory adapter | `adapters/src/memory.rs` |
| Add Postgres adapter | `adapters/src/postgres_registry.rs` |
| Add HTTP endpoint | `ingress/src/main.rs` (axum Router) — see `ingress/CLAUDE.md` |
| Add middleware | `ingress/src/` (authn.rs, authz.rs) |
| Add DB migration | `control_plane_db/migrations/YYYYMMDDHHMMSS_description.sql` then `make db-migrate` |
| Add seed data | `control_plane_db/src/bin/seed.rs` |
| Add/modify WASM plugin | `plugins/<name>/`, build: `cargo build --manifest-path plugins/<name>/Cargo.toml --target wasm32-unknown-unknown --release` |
| Add render tree node type | `wasm_runtime/src/render_tree.rs` (14 node types, V1-V17 validation rules) |
| Change environment config | `atlas_config/src/lib.rs` |

## Build & Test

```bash
cargo build                                    # build all
cargo test                                     # test all
cargo build -p atlas-platform-ingress          # single crate
cargo test -p atlas-platform-runtime           # single crate
cargo test -p atlas-wasm-runtime               # WASM tests (build demo plugin first)
cargo clippy --all-targets --all-features -- -D warnings  # lint
```

Build demo WASM plugin (required before wasm_runtime tests):
```bash
cargo build --manifest-path plugins/demo-transform/Cargo.toml --target wasm32-unknown-unknown --release
```

## Hexagonal Rule

New functionality follows this pattern:
1. Define port trait in `runtime/src/ports.rs`
2. Implement in `adapters/` (in-memory first, Postgres later)
3. Consume via `Arc<dyn PortTrait>` in `ingress/` or `workers/`

Never bypass ports with direct adapter usage in ingress/workers.

## Spec References

- `specs/architecture.md` — principles, invariants, full design
- `specs/crosscut/authn.md` — authentication system (implemented)
- `specs/crosscut/authz.md` — authorization system (implemented)
- `specs/crosscut/errors.md` — error taxonomy and failure semantics
- `specs/crosscut/events.md` — event vocabulary and flow
- `specs/normative_requirements.md` — compiler compliance rules
