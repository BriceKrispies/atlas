# Atlas Ingress

Single HTTP chokepoint — Invariant I1. ALL external requests pass through this crate. Axum-based.

## File Map

| File | Responsibility |
|------|---------------|
| `main.rs` | Axum router definition, AppState, `handle_intent()`, `handle_render()`, route registration |
| `bootstrap.rs` | AppState construction, RuntimeConfig, action registry, policy loading |
| `authn.rs` | Authentication middleware. `X-Debug-Principal` (test-auth feature) or OIDC JWT |
| `authz.rs` | Authorization. Tenant validation + PolicyEngine (deny-overrides-allow) |
| `schema.rs` | JSON schema validation registry for intent payloads |
| `worker.rs` | In-process event loop: polls events, builds projections, runs WASM plugins |
| `render_tree_store.rs` | Postgres-backed render tree projection store (write-through, fallback read) |
| `events.rs` | Event handling utilities |
| `errors.rs` | Ingress-specific error types |
| `metrics.rs` | Prometheus metrics instrumentation |
| `sse.rs` | Server-sent events support |
| `ws.rs` | WebSocket support |
| `lib.rs` | Re-exports |

## Request Flow

```
POST /api/v1/intents
  → authn.rs (resolve principal)
  → authz.rs (tenant validation + policy check — I2: BEFORE execution)
  → schema.rs (validate intent payload)
  → idempotency check (I3)
  → event store append
  → 202 Accepted

GET /api/v1/pages/:id/render
  → authn.rs
  → tenant scoping (I7)
  → projection lookup (cache → in-memory → Postgres fallback)
  → 200 OK / 404
```

Detailed trace: `SYSTEM_MAP.md` section D.

## Invariants Enforced Here

- **I1**: This IS the chokepoint. No other crate exposes HTTP.
- **I2**: `authz.rs` runs before `handle_intent()` body — no side effects on denied requests
- **I3**: Idempotency check in `handle_intent()` before event append
- **I5**: correlationId assigned here if not present in request headers

## Build & Test

```bash
cargo build -p atlas-platform-ingress                       # build
cargo build -p atlas-platform-ingress --features test-auth  # with debug auth
cargo test -p atlas-platform-ingress                        # unit tests
cargo test -p atlas-platform-ingress --features test-auth   # unit tests with test auth
make itest                                                  # full integration tests
```

## Gotcha

On Windows, if `ingress.exe` is running, `cargo build` fails with "access denied" on the link step. Kill the process first, or use `cargo check` to verify compilation without linking.

## Where to Make Changes

| Task | Where |
|------|-------|
| Add new API endpoint | `main.rs` — add route to the axum Router |
| Change auth logic | `authn.rs` |
| Change authorization rules | `authz.rs` + `core/src/policy.rs` |
| Add schema validation | `schema.rs` + `specs/schemas/contracts/` |
| Add projection | `worker.rs` (event processing) + `render_tree_store.rs` (storage) |
| Add SSE channel | `sse.rs` |
| Add WebSocket handler | `ws.rs` |
| Change bootstrap / config | `bootstrap.rs` |
| Add metrics | `metrics.rs` |
