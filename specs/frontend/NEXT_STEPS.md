# Next Steps

Concrete implementation steps after the documentation exists, ordered by dependency.

## Phase 0: Monorepo Scaffold

- [ ] Initialize `frontend/` directory with `pnpm-workspace.yaml`
- [ ] Create root `package.json` with workspace scripts
- [ ] Create `jsconfig.json` with shared module resolution and path aliases
- [ ] Create `.eslintrc.js` with shared lint rules
- [ ] Create root `playwright.config.js` with projects for each app
- [ ] Add `frontend/` build/test targets to root `Makefile`

## Phase 1: Component System (`@atlas/core`)

This is the foundation — everything else depends on it.

- [ ] `@atlas/core` `html.js` — tagged template literal with auto-escaping, event binding (`@click`), property binding (`.prop`), efficient DOM patching
- [ ] `@atlas/core` `signals.js` — `signal()`, `computed()`, `effect()` reactive primitives
- [ ] `@atlas/core` `component.js` — `Component` base class with `onMount`, `onUnmount`, `render()`, `surfaceId`, `testId`, `emit()` telemetry integration
- [ ] `@atlas/core` `router.js` — history-based router with route guards, lazy loading via `import()`
- [ ] `@atlas/core` `store.js` — `query()` and `mutate()` for cached, deduplicated data fetching with signal-based state
- [ ] `@atlas/core` `channel.js` — server event channels: SSE default (`EventSource` wrapper with auto-reconnect, auth, tenant context), WebSocket opt-in, event → signal integration, `channel.connected` status signal
- [ ] `@atlas/core` `offload.js` — Web Worker pool for heavy computation, serialize function + input, return promise, never block main thread
- [ ] `@atlas/core` `context.js` — scoped context propagation (dependency injection)
- [ ] Vitest tests for each module
- [ ] ESLint rules: flag `await` in `render()`, flag synchronous XHR, flag `alert()`/`confirm()`/`prompt()`, flag direct DOM queries in `render()`

## Phase 2: Foundation Packages (no app code yet)

Build the shared platform layer. Each package should have its own tests.

### 2a. Zero-dependency packages
- [ ] `@atlas/contracts` — `SurfaceContract`, `StateSpec`, `ElementSpec`, `IntentSpec`, `TelemetryEventSpec`, `A11ySpec` shape definitions (JSDoc) + runtime validators
- [ ] `@atlas/test-ids` — `testId(surfaceId, elementName)` helper, naming convention regex validator

### 2b. Core infrastructure packages
- [ ] `@atlas/telemetry` — `TelemetryEvent` type, `emit()`, surface context propagation, `correlationId` generator, console transport (dev mode)
- [ ] `@atlas/auth` — OIDC client for Keycloak, auth context, session management, route guards, permission gates
- [ ] `@atlas/api-client` — typed `fetch` wrapper with `X-Correlation-Id` header injection, tenant context, timing telemetry, error normalization

### 2c. UI packages
- [x] `@atlas/design` — design tokens as CSS custom properties (`tokens.css`) + atlas custom elements. Every element extends `AtlasElement` and auto-generates `data-testid` from `name` attribute + nearest `AtlasSurface` context.
  - Shadow DOM (encapsulated): `<atlas-button>`, `<atlas-input>`, `<atlas-skeleton>`, `<atlas-badge>`
  - Light DOM (layout/text): `<atlas-box>`, `<atlas-text>`, `<atlas-heading>`, `<atlas-stack>`
  - Light DOM (table): `<atlas-table>`, `<atlas-row>`, `<atlas-table-head>`, `<atlas-table-body>`, `<atlas-table-cell>`
  - Light DOM (navigation): `<atlas-nav>`, `<atlas-nav-item>`
  - Future: `<atlas-select>`, `<atlas-dialog>`, `<atlas-toast>`, `<atlas-error-panel>`, `<atlas-link>`
- [ ] `@atlas/a11y` — live region announcer, focus management utilities, skip link component
- [ ] `@atlas/errors` — error boundary with telemetry, error state component, retry panel
- [ ] `@atlas/loading` — skeleton components (text, table, card), spinner with `aria-busy`
- [ ] `@atlas/shell` — `AppShell` (header + sidebar + main slots), `Breadcrumbs`, `NavItem` with `aria-current`

### 2d. Test infrastructure
- [ ] `@atlas/test-fixtures` — `atlasTest` extended fixture, `mockApi`, `loginAs`, `telemetrySpy`, `assertA11y`, custom matchers (`toHaveEmitted`)

## Phase 3: First App Shell

- [ ] Bootstrap `@atlas/admin` app with Vite
- [ ] Create `AdminShell` (extends `Component`) with sidebar navigation, header, `<main>` region
- [ ] Create `AdminNav` with navigation items for all 8 modules (links to placeholder pages)
- [ ] Wire auth context with Keycloak OIDC
- [ ] Wire surface context for telemetry
- [ ] Wire error boundary at shell level
- [ ] Create placeholder pages for each module that show "Coming soon" with correct `surfaceId` and `data-testid`
- [ ] Verify: admin shell loads, authenticates, navigates between module placeholders

## Phase 4: First Complete Surface

Implement `admin.content.pages-list` as the reference surface. This proves the entire workflow from contract through receipts.

- [ ] Write surface contract (`pages-list.surface.js`)
- [ ] Write Playwright tests (all states, acceptance scenarios, telemetry, a11y)
- [ ] Implement `PagesListPage` component (extends `Component`, uses `@atlas/design` primitives)
- [ ] Implement `usePages()` query wrapper using `@atlas/api-client` + `@atlas/core` `query()`
- [ ] Verify all Playwright tests pass
- [ ] Verify telemetry events emit correctly
- [ ] Verify axe scan passes
- [ ] Document this as the reference implementation for future surfaces

## Phase 5: Remaining Admin Surfaces

Work through each module's admin surfaces:

- [ ] Content: page editor, media library, announcements config
- [ ] Badges: badge list, badge editor, badge awards
- [ ] Points: points config, points history
- [ ] Org: business unit tree, unit editor
- [ ] Comms: email template list, template editor, notification history
- [ ] Tokens: token list, token editor
- [ ] Import: upload wizard, import history
- [ ] Audit: intent history viewer with filters and export

## Phase 6: Portal App

- [ ] Bootstrap `@atlas/portal` app
- [ ] Create portal shell with user-facing navigation
- [ ] Implement dashboard with widget grid
- [ ] Implement page viewer (render tree → DOM renderer)
- [ ] Implement badges display
- [ ] Implement points history
- [ ] Implement announcements widget
- [ ] Implement profile and settings

## Phase 7: Public Renderer

- [ ] Bootstrap `@atlas/public` app (minimal shell, no auth)
- [ ] Implement public page renderer
- [ ] Implement public media viewer
- [ ] Optimize for performance (minimal JS, fast first paint)

## Phase 8: Platform Control

- [ ] Bootstrap `@atlas/platform-control` app
- [ ] Implement tenant management
- [ ] Implement bundle management
- [ ] Implement schema registry browser
- [ ] Implement global policy editor
- [ ] Implement platform health dashboard

## Phase 9: CI Enforcement

- [ ] Playwright tests run on every PR that touches `frontend/`
- [ ] Surface contract lint: every surface has a contract file
- [ ] Test ID lint: every `data-testid` in code matches a contract
- [ ] axe-core scan: zero violations on all tested surfaces
- [ ] Bundle size budgets per app
- [ ] ESLint rules enforced (no unused vars, no implicit globals, JSDoc on public APIs)

## Phase 10: UI Bundle System

- [ ] Connect to existing `specs/crosscut/ui.md` bundle system
- [ ] Build pipeline: compile app → versioned bundle artifact
- [ ] Bundle registry: store, version, publish bundles
- [ ] Tenant selection: assign bundle to tenant via control plane
- [ ] Theme support: design token overrides per bundle
