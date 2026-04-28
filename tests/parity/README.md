# Parity tests

Two-mode Vitest suite that runs the same scenarios against two backends:

- **Sim mode (`*-sim.test.ts`):** in-process. Instantiates `BrowserIngress`
  via `lib/sim-factory.ts`, which wires `@atlas/ingress` to the IDB adapters
  through `fake-indexeddb`. Pure JS, no services required.
- **Node mode (`*-node.test.ts`):** real HTTP. Instantiates `BrowserIngress`
  via `lib/server-factory.ts`, which talks to a running `apps/server` over
  `fetch`. Requires the server (with Postgres + test-auth enabled) to be
  reachable on `NODE_PARITY_BASE_URL`.

Both factories implement the same `BrowserIngress` interface declared in
`lib/factory.ts`. Test bodies assert against that interface; the only
difference between the two `*-sim` / `*-node` files for a given scenario is
the factory import.

When **both** modes are green for two consecutive weeks, parity is "proven for
the current scope" and the Rust sunset (Chunk 8) can begin.

## Running

```bash
# Sim mode (always runs).
pnpm test:parity:sim

# Node mode — requires apps/server running with TEST_AUTH_ENABLED=true and
# DEBUG_AUTH_ENDPOINT_ENABLED=true. The most common invocation:
NODE_PARITY_BASE_URL=http://localhost:3000 pnpm test:parity:node

# Both at once (node files silent-skip when env is unset).
pnpm test:parity
```

The sim/node split is **file-pattern based**, not test-name pattern:

- `pnpm test:parity:sim` includes `tests/parity/*-sim.test.ts`
- `pnpm test:parity:node` includes `tests/parity/*-node.test.ts`
- `pnpm test:parity` includes both

Test names additionally carry a `[sim]` / `[node]` describe prefix so a single
ripgrep can show the matched-pair coverage:

```bash
rg "test\\(.*test_seed_package_apply" tests/parity
```

## Adding a new parity scenario

1. Pick a Rust suite in `tests/blackbox/suites/`. Read the test bodies.
2. If a scenario depends on a fixture or a payload shape, add a helper to
   `lib/intent-fixtures.ts` (or `lib/fixtures.ts` for catalog seed data) so
   both modes use the same envelope.
3. Add the same `test('test_name', ...)` body to **both**
   `<suite>-sim.test.ts` and `<suite>-node.test.ts`.
   - Use `makeSimIngress(prefix)` in sim files.
   - Use `makeServerIngress(prefix)` in node files.
   - Wrap node `describe(...)` blocks with the `baseUrl ? describe : describe.skip`
     guard so they silent-skip when `NODE_PARITY_BASE_URL` is unset.
4. If the scenario needs a sim-only escape hatch (event-store reads, search
   doc indexing, etc.), it lives only in the sim file. Document the deferral
   in `DEFERRED.md`.

## Skipped or deferred scenarios

See `DEFERRED.md`.

## Files

- `lib/factory.ts` — shared `BrowserIngress` interface.
- `lib/sim-factory.ts` — IDB-backed factory; sim-only escape hatches.
- `lib/server-factory.ts` — `fetch`-backed factory targeting `apps/server`.
- `lib/fixtures.ts` — catalog seed payload + intent envelope helper.
- `lib/intent-fixtures.ts` — variant intents (idempotency, mismatch, etc.)
  used across the auth/authz/idempotency/intent-submission suites.
- `<suite>-sim.test.ts` / `<suite>-node.test.ts` — paired scenario files.
