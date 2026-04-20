# Black-Box Integration Tests

End-to-end tests that run against the full Atlas stack (ingress + Postgres + Keycloak). Tests exercise the system as an external client — no internal state access.

## Commands

```bash
make itest          # full workflow: start stack → wait → run tests
make itest-up       # start stack only
make itest-test     # run tests only (stack must be running)
make itest-down     # stop stack
make itest-reset    # full reset: down → clean volumes → up
make itest-status   # check service status
make itest-logs     # tail all container logs
```

Test binary directly:
```bash
cd tests/blackbox && cargo test --release -- --test-threads=4
```

## File Layout

```
tests/blackbox/
├── suites/                    # Test files (one per concern)
│   ├── health_test.rs         # Liveness, readiness, metrics
│   ├── intent_submission_test.rs  # Core intent API
│   ├── idempotency_test.rs    # Invariant I3
│   ├── authorization_test.rs  # Invariant I2
│   ├── authentication_test.rs # OIDC/JWT flows
│   ├── observability_test.rs  # Prometheus metrics
│   ├── closed_loop_test.rs    # Intent → projection → query pipeline
│   ├── render_tree_test.rs    # WASM render tree end-to-end
│   └── persistence_test.rs    # Postgres persistence
├── harness/                   # Shared test infrastructure
│   ├── mod.rs                 # Harness entry point
│   ├── fixtures.rs            # Test data factories
│   └── ...                    # HTTP client, assertions, auth helpers
├── Cargo.toml
└── src/lib.rs
```

## Test Suites

| Suite | What it validates |
|-------|-------------------|
| `health_test` | Service health endpoints, Prometheus metrics exposure |
| `intent_submission_test` | POST /api/v1/intents — payload validation, event storage, 202 response |
| `idempotency_test` | Invariant I3 — duplicate intent rejection |
| `authorization_test` | Invariant I2 — denied requests produce no side effects |
| `authentication_test` | OIDC/JWT token validation, principal resolution |
| `observability_test` | Prometheus counters, histograms, labels |
| `closed_loop_test` | Full write-read pipeline: intent → event → projection → query |
| `render_tree_test` | WASM plugin execution, render tree materialization |
| `persistence_test` | Postgres event store, projection store durability |

## Adding a New Test

1. Create `suites/<name>_test.rs`
2. Use harness helpers: `use crate::harness::*;` for HTTP client, auth, fixtures
3. Register module in `suites/mod.rs` (if using module structure) or ensure Cargo.toml includes the file
4. Run: `make itest-test`

## Stack Requirements

The itest stack provides:
- Ingress binary (with `test-auth` feature enabled)
- Postgres (control plane DB, migrated + seeded)
- Keycloak (OIDC provider)
- Optional: observability stack (`make itest-up-obs`)

Compose file: `infra/compose/docker-compose.itest.yml`
