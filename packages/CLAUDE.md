# `/packages` — Shared Infrastructure

Reusable libraries that are not domain-specific (those live in
[`/modules`](../modules/CLAUDE.md)) and not infrastructure-specific (those live
in [`/adapters`](../adapters/CLAUDE.md)). The UI primitives, the design system,
the runtime utilities, and the cross-cutting tools all live here.

## Primary Packages

These are load-bearing — read their CLAUDE.md before editing.

| Package | What lives here |
|---------|-----------------|
| **`core/`** — `@atlas/core` | `AtlasElement` (base for every UI element), `AtlasSurface`, signals, `html` template tag. **Read [`core/CLAUDE.md`](core/CLAUDE.md).** |
| **`design/`** — `@atlas/design` | Every Atlas custom web component. **New components go here.** **Read [`design/CLAUDE.md`](design/CLAUDE.md).** |

## Supporting Packages

| Package | Purpose |
|---------|---------|
| `widgets/` — `@atlas/widgets` | Composite widgets built on core+design (data-table, charts, KPI tiles, drill-downs, pagination, time-range filters) |
| `widget-host/` — `@atlas/widget-host` | Widget runtime: registry, manifest validation, sandbox modes (inline / shadow / iframe), capabilities IPC |
| `page-templates/` — `@atlas/page-templates` | Page + widget layout templates: content-page, block-editor, layout-editor |
| `api-client/` — `@atlas/api-client` | Backend adapter factory; switches between mock and HTTP backends via `VITE_BACKEND` |
| `ingress/` — `@atlas/ingress` | Intent submission, read evaluation, fetch interception |
| `schemas/` — `@atlas/schemas` | JSON Schema registry; AJV loader; `pnpm sync-schemas` populates `src/generated/` |
| `platform-core/` — `@atlas/platform-core` | Server-side domain primitives: cache-key builders, singleflight, control-plane DB types, env config, validation |
| `wasm-host/` — `@atlas/wasm-host` | WASM plugin sandbox (16 MB cap, 5 s timeout); browser + node-worker adapters |
| `metrics/` — `@atlas/metrics` | Telemetry event shapes + helpers (`atlas-metrics`, `guardrail`) |
| `logging/` — `@atlas/logging` | Structured-JSON logger. Non-blocking hot path (setImmediate-batched async drain to stdout); zero runtime deps; runtime-adjustable level. Enforces [`specs/crosscut/logging.md`](../specs/crosscut/logging.md). |
| `test-state/` — `@atlas/test-state` | Dev-mode test API: surfaces register state readers; Playwright reads via `window.__atlasTest` |
| `test-fixtures/` — `@atlas/test-fixtures` | Playwright + Axe accessibility helpers |
| `contract-tests/` — `@atlas/contract-tests` | Vitest contract suites for ports — both `node` and `idb` adapters run these |
| `eslint-plugin-atlas-widgets/` — `@atlas/eslint-plugin-widgets` | Lint rules for component best practices |

## Reading surface state from BDD steps

`@atlas/test-state` is how Playwright BDD steps read live surface state
without scraping the DOM. Pattern:

- Each `AtlasSurface` registers a state reader at mount time. The reader
  exposes whatever shape the test needs (currently selected row, loading
  flag, validation errors, etc.).
- In dev mode (`VITE_BDD=true` for the BDD harness; or whichever env flag
  the surface gates on), the package mounts a `window.__atlasTest` global.
- BDD step definitions call `await page.evaluate(() => window.__atlasTest.getSurface(id).state)` and assert on the returned shape.

Use this instead of querying the DOM for state. DOM queries are brittle to
markup changes; the test-state contract is part of the surface's spec.

The harness boot lives in `apps/sim` (see
[`tests/bdd/README.md`](../tests/bdd/README.md)).

## Dependency Graph (high level)

```
design ──────────► core
widgets ─────────► core, design, test-state
widget-host ─────► core, design
page-templates ──► core, design, widget-host, test-state
api-client ──────► core
ingress ─────────► metrics, platform-core, ports
wasm-host ───────► ports
contract-tests ──► platform-core, ports
schemas ─────────► (standalone, used by adapters and apps)
```

Frontend apps pull in `core` + `design` + `widgets` (+ `widget-host` + `page-templates` for authoring/sandbox). Server apps pull in `ingress`, `platform-core`, `schemas`, `metrics`, `wasm-host`.

## Conventions

- **Workspace name = `@atlas/<dir>`.** Most packages drop the `@atlas/` prefix in their dir name (e.g., `core/` → `@atlas/core`). Exception: `eslint-plugin-atlas-widgets`.
- **Single `src/index.ts` re-export.** Every package's public surface comes through `src/index.ts`. If something is not re-exported there, treat it as private.
- **No domain logic.** Anything tenant-specific or business-logic-heavy belongs in `/modules`.
- **No HTTP.** Only `apps/server` exposes HTTP endpoints (Invariant I1).

## When to Create a New Package vs. Add to Existing

- **New custom element?** → `/packages/design`. Don't make a new package.
- **New composite widget that wraps several design components?** → `/packages/widgets`.
- **New sandboxed runtime / cross-cutting infrastructure?** → new package, narrow scope, single responsibility.
- **New port?** → not here. See [`/ports`](../ports/CLAUDE.md).
