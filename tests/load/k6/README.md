# k6 load tests

[k6](https://k6.io) is a Go-based HTTP load tester. Where the gambler's
TypeScript settler is bottlenecked around 1-2k rps per machine by Node's
`fetch`, k6 saturates 50-100× harder per machine and has industrial-grade
scenario shapes (constant-arrival-rate, ramping, soak, spike) built in.

Use k6 when you want to know the **actual ceiling**. Use the gambler's
TS settler when you want to iterate quickly while changing server code.

## Install

| Platform | Command |
|----------|---------|
| Windows  | `choco install k6` or download from <https://github.com/grafana/k6/releases/latest> |
| macOS    | `brew install k6` |
| Linux    | See <https://k6.io/docs/getting-started/installation/> |

Verify: `k6 version` should print something like `k6 v0.50.0`.

## Run a scenario

Start Atlas (separate shell):
```pwsh
make db-up
$env:TEST_AUTH_ENABLED='true'; pnpm --filter '@atlas/server' dev
```

Then run a scenario:
```pwsh
k6 run tests/load/k6/steady-state.js
k6 run tests/load/k6/burst.js
```

To override config without editing the file:
```pwsh
k6 run -e ATLAS_URL=http://localhost:3000 -e TENANT_ID=dev-tenant tests/load/k6/steady-state.js
```

To dump JSON for later analysis:
```pwsh
k6 run --out json=run.json tests/load/k6/steady-state.js
```

## Reading the output

At the end of a run k6 prints:

```
http_req_duration..............: avg=12ms  p(95)=45ms  p(99)=120ms
http_req_failed................: 0.00%  ✓ 0  ✗ 12000
checks.........................: 100.00% ✓ 12000  ✗ 0
vus_max........................: 500
iterations.....................: 12000
iteration_duration.............: avg=42ms
```

The metric to track for ingress capacity is **`http_req_duration p(99)`**;
the threshold to track is **`http_req_failed`**. Both are declared in each
scenario's `thresholds` block so a regression fails the run.

## Scenarios

| File | Purpose |
|------|---------|
| `steady-state.js` | Ramping ladder — find the rps ceiling for a single-tenant single-principal workload. |
| `burst.js` | Baseline → 5× spike → recovery. Measures peak p99 + recovery time. |

Deferred (file as a ticket if you need them):
- `soak.js` — hour-long constant load (memory leaks, projection-store growth)
- `multi-tenant.js` — needs multi-tenant seeding in the control plane first

## Talking to Atlas

All scenarios assume:
- `TEST_AUTH_ENABLED=true` on the server (so `X-Debug-Principal` works)
- Tenant `dev-tenant` exists (the default seeded fallback)
- Server is on `http://localhost:3000` (override with `-e ATLAS_URL=...`)

The intent body fired is `ContentPages.Page.Read` against a missing page —
the same cheap path the gambler's settler uses. It exercises
enrichPrincipal + policy bundle load + audit emit (the hot path the
optimization work targets) without doing real domain work.
