# Atlas Frontend Architecture

## Why Atlas Has 4 Frontends

Atlas is a multi-tenant enterprise CMS + workflow platform. Different audiences have fundamentally different concerns, security postures, and deployment needs. Forcing them into one application creates coupling that slows every team down. Splitting them into fully isolated applications wastes the 80% of infrastructure they share.

Atlas has **4 frontends**:

| Frontend | Audience | Auth | Purpose |
|----------|----------|------|---------|
| **Admin Console** | Tenant administrators | OIDC (Keycloak) | Manage modules, policies, users, content, badges, org structure, media, templates, imports |
| **Portal** | End users within a tenant | OIDC (Keycloak) | View content, earn badges, see points, receive announcements, use messaging |
| **Public Renderer** | Unauthenticated visitors | None / token-scoped | View published public pages, access public media URLs |
| **Platform Control** | Platform operators (super-admin) | OIDC + MFA | Manage tenants, bundles, platform config, schema registry, global policies |

Each frontend is a separate deployable application with its own routing, shell, and feature set. They share a **common frontend platform layer** that provides design primitives, auth plumbing, telemetry, testing infrastructure, and surface-contract types.

## Why a Shared Platform Layer

Without shared infrastructure, 4 frontends means 4 implementations of:
- Authentication / session management
- API client with tenant context and correlation IDs
- Telemetry event emission
- Accessible form/table/dialog primitives
- Playwright test fixtures and helpers
- Error and loading state patterns
- Design tokens and component library

That is unacceptable. The shared platform layer exists so that **every frontend inherits correct behavior by default** and individual apps only own their feature-specific concerns.

## Core Design Doctrine

### Surfaces Are Contracts

Every page, widget, and interactive region is a **surface** with a formal contract. The contract defines its route, purpose, auth requirements, states, elements, test IDs, telemetry events, and accessibility expectations. No surface exists without a contract. No implementation proceeds without a contract. See [surface-contract.md](./surface-contract.md).

### Testability Is First-Class

Every interactive element has a stable `data-testid`. Every surface has Playwright coverage for all required states. Tests are written before or alongside implementation, never after. Test IDs are part of the surface contract and are as stable as API endpoints. See [testing-strategy.md](./testing-strategy.md).

### Observability Is First-Class

Every user interaction emits a structured telemetry event. Every surface carries a `surfaceId`. Every intent carries a `correlationId` that connects frontend action to backend event. There are no uninstrumented interactive elements. See [observability.md](./observability.md).

### Accessibility Is First-Class

Accessibility is a platform requirement, not polish applied later. Every form has labels. Every button has an accessible name. Every dialog traps focus. Every error is announced to assistive technology. Semantic HTML is the default; ARIA is the escape hatch. See [accessibility.md](./accessibility.md).

### AI Agents Must Be Able to Add Features with Receipts

The documentation, contracts, and tooling are designed so that an AI agent can:

1. Read a surface contract
2. Generate Playwright tests
3. Implement the UI using approved primitives
4. Verify observability and accessibility requirements
5. Produce **receipts** — Playwright test results, telemetry event samples, accessibility audit output — that prove the feature works correctly

This is what **"scalable with receipts"** means: the system scales feature development by ensuring every addition is machine-verifiable.

### No Frameworks — We Own the Stack

Atlas frontends are built with **modern vanilla JavaScript** and a custom web component system (`@atlas/core`). No React, no Vue, no Angular. The component system uses tagged template literals (`html\`...\``) for rendering, signals for fine-grained reactivity, and **web components** (`AtlasElement extends HTMLElement`) as the rendering primitive. Every element in a template is an atlas custom element — no raw HTML elements (`<div>`, `<p>`, `<h1>`, `<table>`, etc.) appear in `render()` output. This means `data-testid` generation is automatic (via `name` attribute + surfaceId inheritance), telemetry hooks and ARIA attributes are enforced at the platform level, not bolted on after the fact.

### All Elements Are Atlas Web Components

Templates use **only** atlas custom elements. There is no raw HTML in `render()` output. This ensures:

1. **Every element is under atlas control** — the platform owns the rendering pipeline end-to-end.
2. **Automatic `data-testid`** — elements with a `name` attribute auto-generate `data-testid` by combining the nearest `AtlasSurface`'s `surfaceId` with the `name` value. No manual `data-testid` wiring.
3. **Consistent API** — developers learn one system. Interactive elements (`<atlas-button>`, `<atlas-input>`) use Shadow DOM for encapsulation. Structural elements (`<atlas-box>`, `<atlas-stack>`, `<atlas-heading>`, `<atlas-text>`, `<atlas-table>`, `<atlas-row>`, etc.) use Light DOM to participate in parent layout context.
4. **No browser default behavior surprises** — every element's semantics are explicitly defined by the component.

## Key Concepts

| Term | Definition |
|------|------------|
| **`@atlas/core`** | The web component system: `AtlasElement` (extends `HTMLElement`), `AtlasSurface` (extends `AtlasElement`), `html` tagged templates, signals, router, `query()`, `channel()`, `offload()` |
| **AtlasElement** | Base class for all atlas custom elements. Extends `HTMLElement`. Auto-generates `data-testid` from nearest `AtlasSurface`'s `surfaceId` + own `name` attribute. |
| **AtlasSurface** | Base class for page/widget/dialog surfaces. Extends `AtlasElement`. Declares `static surfaceId`. Provides context for child element testid generation. |
| **Surface** | A bounded UI region (page, widget, dialog) with a formal contract |
| **Surface Contract** | The specification for a surface: route, states, elements, test IDs, telemetry, a11y |
| **Stable Test ID** | A `data-testid` value auto-generated from `surfaceId` + `name` attribute. Part of the contract and must not change without versioning |
| **Frontend Receipt** | Machine-verifiable proof that a feature works: passing Playwright tests, emitted telemetry, a11y audit |
| **Feature Slice** | A vertical cut through the stack: contract + tests + implementation + telemetry for one feature |
| **Shared Frontend Platform** | The common packages shared across all 4 frontends |
| **App Shell** | The per-frontend container: layout, navigation, routing, auth gate |
| **Playwright-First Delivery** | Writing Playwright coverage as part of (not after) feature implementation |
| **No Uninstrumented UI** | Every interactive element emits telemetry and has a test ID — no dark spots |
| **Non-Blocking UI** | `render()` is synchronous and fast; all async work is in `query()`, `effect()`, `channel()`, `offload()` — the main thread never blocks |
| **Server Event Channel** | `channel()` connects to SSE/WebSocket; server events feed signals directly — no polling, no manual refresh |
| **`offload()`** | Moves heavy computation to a Web Worker — main thread stays responsive |

## Documentation Index

| Document | Purpose |
|----------|---------|
| [architecture.md](./architecture.md) | Overall frontend architecture and 4-frontend model |
| [constitution.md](./constitution.md) | Hard rules (MUST/MUST NOT) for all frontend code |
| [surface-contract.md](./surface-contract.md) | Canonical structure for surface contracts |
| [testing-strategy.md](./testing-strategy.md) | Playwright-first testing approach |
| [observability.md](./observability.md) | Telemetry standards and correlation |
| [accessibility.md](./accessibility.md) | Accessibility requirements |
| [repo-structure.md](./repo-structure.md) | Monorepo layout and package boundaries |
| [ai-agent-workflow.md](./ai-agent-workflow.md) | Step-by-step workflow for AI-driven feature development |
| [adr-001-four-frontends-shared-platform.md](./adr-001-four-frontends-shared-platform.md) | Architecture decision record |
| [NEXT_STEPS.md](./NEXT_STEPS.md) | Concrete next implementation steps |
