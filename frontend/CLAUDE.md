# Atlas Frontend

Vanilla web components — no React, Vue, or Angular. Custom component system built on `@atlas/core`.

## Architecture

- `AtlasElement` extends `HTMLElement` — base for all components
- `AtlasSurface` extends `AtlasElement` — base for pages, widgets, dialogs
- `html` tagged template literals for rendering (never raw `innerHTML`)
- Signals for reactivity
- All UI uses atlas custom elements — **no raw HTML in `render()`**

Full architecture: `specs/frontend/architecture.md`
Constitutional rules: `specs/frontend/constitution.md` (15 rules, C1-C15)

## Package Map

| Package | Purpose |
|---------|---------|
| `packages/core` (`@atlas/core`) | AtlasElement, AtlasSurface, signals, router, `html` templates, `query()`, `channel()`, `offload()` |
| `packages/design` (`@atlas/design`) | Design tokens, atlas custom elements (`<atlas-button>`, `<atlas-input>`, `<atlas-table>`, etc.) |
| `packages/api-client` (`@atlas/api-client`) | Typed HTTP client for ingress API with correlationId |
| `packages/test-fixtures` (`@atlas/test-fixtures`) | Playwright helpers: `atlasTest`, `mockApi`, `loginAs`, `telemetrySpy` |
| `apps/admin` (`@atlas/admin`) | Tenant admin console |
| `apps/sandbox` (`@atlas/sandbox`) | Design system sandbox / component playground |
| `apps/authoring` (`@atlas/authoring`) | Interactive page / layout / block editors |

## Commands

```bash
pnpm dev              # start admin dev server
pnpm sandbox          # start design sandbox
pnpm authoring        # start authoring app (page/layout/block editors)
pnpm build            # build all apps
pnpm test             # run unit tests
pnpm test:e2e         # Playwright tests
pnpm test:e2e:ui      # Playwright with UI mode
pnpm test:integration # integration tests (requires itest stack)
```

## Key Rules Agents Must Follow

These are the constitutional rules agents violate most. Full list: `specs/frontend/constitution.md`.

- **C1**: Every surface needs a surface contract BEFORE implementation — write the contract first
- **C2**: Test IDs are auto-generated from `surfaceId` + `name` attribute. NEVER set `data-testid` manually.
- **C11**: No raw HTML in `render()`. Only atlas custom elements (`<atlas-box>`, `<atlas-text>`, `<atlas-heading>`, `<atlas-button>`, `<atlas-table>`, etc.)
- **C4**: Every surface must implement all required states: loading, empty, success, validationError, backendError, unauthorized
- **C9**: No feature without Playwright coverage. Tests are the receipt.
- **C14**: No polling (`setInterval`). Use `channel()` for server-pushed updates.

## Where to Make Changes

| Task | Where |
|------|-------|
| Add design token / CSS variable | `packages/design/` |
| Create new atlas element | `packages/design/src/` |
| Add new page/surface | `apps/<app>/src/features/<module>/<feature>/` + surface contract |
| Add API call | `packages/api-client/src/` |
| Add/modify Playwright test | `tests/integration/` or co-located `*.test.js` |
| Change router behavior | `packages/core/src/` (router module) |
| Add test fixture/helper | `packages/test-fixtures/src/` |

## AI Agent Workflow for New Surfaces

Follow the 8-step workflow in `specs/frontend/ai-agent-workflow.md`:

1. Read specs → 2. Create surface contract → 3. Define selectors/telemetry → 4. Write Playwright tests → 5. Implement UI → 6. Verify observability + a11y → 7. Register route → 8. Produce receipts

## Spec References

| Topic | File |
|-------|------|
| Constitutional rules (C1-C15) | `specs/frontend/constitution.md` |
| Architecture + component system | `specs/frontend/architecture.md` |
| Surface contract format | `specs/frontend/surface-contract.md` |
| Testing strategy | `specs/frontend/testing-strategy.md` |
| Accessibility requirements | `specs/frontend/accessibility.md` |
| Observability / telemetry | `specs/frontend/observability.md` |
| Agent workflow | `specs/frontend/ai-agent-workflow.md` |
| Repo structure | `specs/frontend/repo-structure.md` |
| ADR: 4 frontends | `specs/frontend/adr-001-four-frontends-shared-platform.md` |
| Implementation phases | `specs/frontend/NEXT_STEPS.md` |
