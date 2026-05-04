# Repository Structure

## Overview

The Atlas frontend lives at the repository root. It is a TypeScript monorepo managed by pnpm workspaces — all frontend apps and shared packages live here.

> **Historical note.** This document was originally drafted when the repo
> hosted a Rust backend under `crates/`. That prototype was deleted on
> 2026-05-04; the TS implementation is now the only one. References
> below to "the Rust backend" or `crates/` are obsolete — treat them as
> historical context.

All code is **modern vanilla JavaScript** — no framework, no TypeScript. The custom component system (`@atlas/core`) provides rendering, reactivity, routing, and data fetching. Type documentation uses JSDoc annotations where useful.

## Complete Directory Tree

```
atlas/
├── crates/                          # Existing Rust backend
├── specs/
│   ├── frontend/                    # This documentation
│   └── modules/                     # Existing module specs
├── frontend/
│   ├── package.json                 # Workspace root
│   ├── pnpm-workspace.yaml          # Workspace definition
│   ├── jsconfig.json                # Shared JS config (module resolution, paths)
│   ├── playwright.config.js         # Root Playwright config
│   ├── .eslintrc.js                 # Shared lint rules
│   │
│   ├── packages/                    # Shared platform packages
│   │   │
│   │   ├── core/                    # @atlas/core — Component system
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── component.js     # Component base class (lifecycle, render, testId)
│   │   │   │   ├── html.js          # Tagged template literal (auto-escape, event binding, DOM patching)
│   │   │   │   ├── signals.js       # signal(), computed(), effect()
│   │   │   │   ├── router.js        # Client-side router (history API, guards, lazy loading)
│   │   │   │   ├── store.js         # query(), mutate() — data fetching + caching
│   │   │   │   ├── channel.js       # Server event channels (SSE default, WebSocket opt-in)
│   │   │   │   ├── offload.js       # Web Worker delegation for heavy computation
│   │   │   │   ├── context.js       # Scoped context propagation (dependency injection)
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │       ├── component.test.js
│   │   │       ├── html.test.js
│   │   │       ├── signals.test.js
│   │   │       ├── router.test.js
│   │   │       ├── store.test.js
│   │   │       ├── channel.test.js
│   │   │       └── offload.test.js
│   │   │
│   │   ├── design/                  # @atlas/design — Design system (all atlas custom elements)
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── tokens.css       # CSS custom properties (colors, spacing, typography, borders)
│   │   │   │   │
│   │   │   │   │  # Interactive elements (Shadow DOM — encapsulated styles)
│   │   │   │   ├── atlas-button.js  # <atlas-button> — click telemetry, variant styling
│   │   │   │   ├── atlas-input.js   # <atlas-input> — label, type, placeholder, required
│   │   │   │   ├── atlas-skeleton.js # <atlas-skeleton> — loading placeholder, rows attr
│   │   │   │   ├── atlas-badge.js   # <atlas-badge> — status indicator
│   │   │   │   │
│   │   │   │   │  # Layout elements (Light DOM — participate in parent CSS context)
│   │   │   │   ├── atlas-box.js     # <atlas-box> — replaces <div>, padding attr
│   │   │   │   ├── atlas-text.js    # <atlas-text> — replaces <p>/<span>, variant attr
│   │   │   │   ├── atlas-heading.js # <atlas-heading> — replaces <h1>-<h6>, level attr
│   │   │   │   ├── atlas-stack.js   # <atlas-stack> — flexbox layout, direction/gap/align/justify
│   │   │   │   │
│   │   │   │   │  # Table elements (Light DOM — CSS display: table-*)
│   │   │   │   ├── atlas-table.js   # <atlas-table> — display:table, role=table, label attr
│   │   │   │   ├── atlas-row.js     # <atlas-row> — display:table-row, parameterized key
│   │   │   │   ├── atlas-table-head.js # <atlas-table-head> — display:table-header-group
│   │   │   │   ├── atlas-table-body.js # <atlas-table-body> — display:table-row-group
│   │   │   │   ├── atlas-table-cell.js # <atlas-table-cell> — display:table-cell, header attr
│   │   │   │   │
│   │   │   │   │  # Navigation elements (Light DOM)
│   │   │   │   ├── atlas-nav.js     # <atlas-nav> — role=navigation, label attr
│   │   │   │   ├── atlas-nav-item.js # <atlas-nav-item> — active attr, hover effects
│   │   │   │   │
│   │   │   │   └── index.js         # Registers all custom elements
│   │   │   └── __tests__/
│   │   │
│   │   ├── contracts/               # @atlas/contracts
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── surface.js       # SurfaceContract shape definition (JSDoc)
│   │   │   │   ├── states.js        # StateSpec, required states
│   │   │   │   ├── elements.js      # ElementSpec, element types
│   │   │   │   ├── intents.js       # IntentSpec definitions
│   │   │   │   ├── telemetry.js     # TelemetryEventSpec definitions
│   │   │   │   ├── a11y.js          # A11ySpec definitions
│   │   │   │   ├── validators.js    # Runtime validators for contracts
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   ├── telemetry/               # @atlas/telemetry
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── events.js        # TelemetryEvent shape, emit()
│   │   │   │   ├── context.js       # Surface context propagation (surfaceId)
│   │   │   │   ├── correlation.js   # correlationId generation and propagation
│   │   │   │   ├── transport.js     # Buffered HTTP transport
│   │   │   │   ├── dev-console.js   # Console transport for development
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   ├── test-ids/                # @atlas/test-ids
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── testId.js        # testId() helper function
│   │   │   │   ├── conventions.js   # Naming convention validation
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   ├── test-fixtures/           # @atlas/test-fixtures
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── atlasTest.js     # Extended Playwright test with fixtures
│   │   │   │   ├── mockApi.js       # API mocking helpers
│   │   │   │   ├── loginAs.js       # Auth simulation
│   │   │   │   ├── telemetrySpy.js  # Telemetry capture for assertions
│   │   │   │   ├── assertA11y.js    # axe-core assertion helper
│   │   │   │   ├── matchers.js      # Custom Playwright matchers
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   ├── auth/                    # @atlas/auth
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── provider.js      # Auth context provider
│   │   │   │   ├── client.js        # OIDC client (Keycloak)
│   │   │   │   ├── session.js       # Session management, token refresh
│   │   │   │   ├── guards.js        # Route guards (requireRole, requirePermission)
│   │   │   │   ├── types.js         # Principal, Role, Permission shape definitions
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   ├── api-client/              # @atlas/api-client
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── client.js        # HTTP client with tenant context
│   │   │   │   ├── interceptors.js  # Auth header, correlationId, timing telemetry
│   │   │   │   ├── errors.js        # Error normalization (ApiError types)
│   │   │   │   ├── types.js         # Request/response shape definitions
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   ├── a11y/                    # @atlas/a11y
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── announcer.js     # LiveRegion announcer
│   │   │   │   ├── focus.js         # Focus management utilities
│   │   │   │   ├── skip-link.js     # SkipLink component
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   ├── errors/                  # @atlas/errors
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── boundary.js      # Error boundary with telemetry
│   │   │   │   ├── states.js        # Error state, retry panel components
│   │   │   │   ├── types.js         # Categorized error types
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   ├── loading/                 # @atlas/loading
│   │   │   ├── package.json
│   │   │   ├── src/
│   │   │   │   ├── skeleton.js      # Skeleton components (text, table, card)
│   │   │   │   ├── spinner.js       # Spinner with aria-busy
│   │   │   │   └── index.js
│   │   │   └── __tests__/
│   │   │
│   │   └── shell/                   # @atlas/shell
│   │       ├── package.json
│   │       ├── src/
│   │       │   ├── AppShell.js      # Base app shell (header, sidebar, main)
│   │       │   ├── Breadcrumbs.js   # Breadcrumb navigation
│   │       │   ├── NavItem.js       # Navigation item with aria-current
│   │       │   ├── SurfaceHost.js   # Surface context host (surfaceId propagation)
│   │       │   └── index.js
│   │       └── __tests__/
│   │
│   ├── apps/                        # Frontend applications
│   │   │
│   │   ├── admin/                   # @atlas/admin — Admin Console
│   │   │   ├── package.json
│   │   │   ├── vite.config.js
│   │   │   ├── index.html
│   │   │   ├── src/
│   │   │   │   ├── main.js          # App entry point
│   │   │   │   ├── routes.js        # Route definitions
│   │   │   │   ├── shell/           # Admin-specific shell
│   │   │   │   │   ├── AdminShell.js
│   │   │   │   │   ├── AdminNav.js
│   │   │   │   │   └── AdminHeader.js
│   │   │   │   └── features/        # Feature slices
│   │   │   │       ├── content-pages/
│   │   │   │       │   ├── contracts/
│   │   │   │       │   │   ├── pages-list.surface.js
│   │   │   │       │   │   └── page-editor.surface.js
│   │   │   │       │   ├── components/
│   │   │   │       │   │   ├── PagesListPage.js
│   │   │   │       │   │   ├── PageEditor.js
│   │   │   │       │   │   └── PageRow.js
│   │   │   │       │   ├── hooks/
│   │   │   │       │   │   └── usePages.js
│   │   │   │       │   ├── pages-list.test.js    # Co-located Playwright tests
│   │   │   │       │   ├── page-editor.test.js
│   │   │   │       │   └── index.js
│   │   │   │       ├── media-library/
│   │   │   │       ├── badges/
│   │   │   │       ├── points/
│   │   │   │       ├── org/
│   │   │   │       ├── comms/
│   │   │   │       ├── tokens/
│   │   │   │       ├── import/
│   │   │   │       └── audit/
│   │   │
│   │   ├── portal/                  # @atlas/portal — End-User Portal
│   │   │   ├── package.json
│   │   │   ├── vite.config.js
│   │   │   ├── index.html
│   │   │   ├── src/
│   │   │   │   ├── main.js
│   │   │   │   ├── routes.js
│   │   │   │   ├── shell/
│   │   │   │   │   ├── PortalShell.js
│   │   │   │   │   ├── PortalNav.js
│   │   │   │   │   └── PortalHeader.js
│   │   │   │   └── features/
│   │   │   │       ├── dashboard/
│   │   │   │       ├── profile/
│   │   │   │       ├── page-viewer/
│   │   │   │       ├── announcements/
│   │   │   │       ├── badges/
│   │   │   │       ├── points/
│   │   │   │       └── messaging/
│   │   │
│   │   ├── public/                  # @atlas/public — Public Renderer
│   │   │   ├── package.json
│   │   │   ├── vite.config.js
│   │   │   ├── index.html
│   │   │   ├── src/
│   │   │   │   ├── main.js
│   │   │   │   ├── routes.js
│   │   │   │   ├── shell/
│   │   │   │   │   └── PublicShell.js  # Minimal chrome
│   │   │   │   └── features/
│   │   │   │       ├── page-renderer/
│   │   │   │       └── media-viewer/
│   │   │
│   │   └── platform-control/       # @atlas/platform-control — Platform Control
│   │       ├── package.json
│   │       ├── vite.config.js
│   │       ├── index.html
│   │       ├── src/
│   │       │   ├── main.js
│   │       │   ├── routes.js
│   │       │   ├── shell/
│   │       │   │   ├── PlatformShell.js
│   │       │   │   ├── PlatformNav.js
│   │       │   │   └── PlatformHeader.js
│   │       │   └── features/
│   │       │       ├── tenants/
│   │       │       ├── bundles/
│   │       │       ├── schemas/
│   │       │       ├── policies/
│   │       │       └── health/
│   │
│   └── tests/
│       └── e2e/                     # Cross-app e2e tests
│           ├── flows/               # Multi-app user flows
│           └── smoke/               # Smoke tests for all apps
```

## Package Dependency Rules

```
                    ┌─────────────────────┐
                    │   External Libs     │
                    │ (Playwright,        │
                    │  axe-core, etc.)    │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │    @atlas/core      │  ← Zero external deps (owns everything)
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │  @atlas/contracts   │  ← No runtime deps (shapes only)
                    │  @atlas/test-ids    │  ← No runtime deps (helpers only)
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────┴──────┐  ┌─────┴──────┐  ┌──────┴────────┐
    │ @atlas/design  │  │@atlas/auth │  │@atlas/telemetry│
    │ @atlas/a11y    │  │@atlas/     │  │               │
    │ @atlas/errors  │  │ api-client │  │               │
    │ @atlas/loading │  │            │  │               │
    │ @atlas/shell   │  │            │  │               │
    └─────────┬──────┘  └─────┬──────┘  └──────┬────────┘
              │               │                │
              └───────────────┼────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │      App Shells    │
                    │ (admin, portal,    │
                    │  public, platform) │
                    └─────────┬──────────┘
                              │
                    ┌─────────┴──────────┐
                    │   Feature Slices   │
                    │ (content-pages,    │
                    │  badges, audit...) │
                    └────────────────────┘
```

**Hard rules:**
- `@atlas/core` has zero external runtime dependencies — it owns rendering, reactivity, routing, and data fetching.
- Platform packages MUST NOT import from apps or feature slices.
- Apps MUST NOT import from other apps.
- Feature slices MUST NOT import from other feature slices.
- Feature slices MAY import from any `@atlas/*` platform package.
- `@atlas/contracts` and `@atlas/test-ids` have zero runtime dependencies.
- `@atlas/test-fixtures` is a devDependency only — it MUST NOT be imported in production code.

## Workspace Configuration

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

### Root `package.json` Scripts

```json
{
  "scripts": {
    "dev:admin": "pnpm --filter @atlas/admin dev",
    "dev:portal": "pnpm --filter @atlas/portal dev",
    "dev:public": "pnpm --filter @atlas/public dev",
    "dev:platform": "pnpm --filter @atlas/platform-control dev",
    "build": "pnpm -r build",
    "build:admin": "pnpm --filter @atlas/admin build",
    "build:portal": "pnpm --filter @atlas/portal build",
    "build:public": "pnpm --filter @atlas/public build",
    "build:platform": "pnpm --filter @atlas/platform-control build",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "test:e2e:admin": "playwright test --project=admin",
    "test:e2e:portal": "playwright test --project=portal",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r lint"
  }
}
```

## Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | JavaScript (ES2024+) | Modern vanilla JS, no compile step, native ES modules |
| Type documentation | JSDoc annotations | Inline type hints for editor support without a build step |
| UI framework | None — `@atlas/core` | Custom component system: tagged templates + signals. Full ownership of rendering pipeline. |
| Build tool | Vite | Fast dev server, clean production builds, native ES module support |
| Unit tests | Vitest | Fast, Vite-native, compatible with our module system |
| E2E tests | Playwright | Framework-agnostic, stable selectors, axe-core integration |
| Package manager | pnpm | Workspace support, disk efficiency, strict hoisting |
| Styling | CSS custom properties + vanilla CSS | Design tokens as CSS vars, no runtime CSS-in-JS, no preprocessor dependency |
| Routing | `@atlas/core` Router | History API-based, route guards, lazy loading via dynamic import() |
| Data fetching | `@atlas/core` query() | Cached, deduplicated, signal-based |
| State management | `@atlas/core` signals | Fine-grained reactivity, no global store, no diffing |
| Linting | ESLint + @atlas/eslint-config | Shared rules enforce constitution |
| Formatting | Prettier | Consistent formatting, no debates |
