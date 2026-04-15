# Frontend Architecture

## The 4-Frontend Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Atlas Ingress API                        │
│         /api/v1/*   (authn → authz → dispatch)             │
└──────────┬──────────┬──────────┬──────────┬─────────────────┘
           │          │          │          │
    ┌──────┴───┐ ┌────┴────┐ ┌──┴───┐ ┌───┴──────┐
    │  Admin   │ │ Portal  │ │Public│ │ Platform │
    │ Console  │ │         │ │Render│ │ Control  │
    └──────────┘ └─────────┘ └──────┘ └──────────┘
           │          │          │          │
    ┌──────┴──────────┴──────────┴──────────┴─────┐
    │         Shared Frontend Platform            │
    │  (@atlas/core, design, auth, telemetry,     │
    │   test infra, API client, a11y)             │
    └─────────────────────────────────────────────┘
```

### Admin Console (`@atlas/admin`)

**Audience:** Tenant administrators
**Auth:** OIDC via Keycloak, requires `admin` role
**Scope:** Full CRUD for all 8 modules within a tenant

Surfaces include:
- Content management (pages, announcements, media library)
- Badge and points configuration
- Organization / business unit management
- Email template editor
- Import / bulk upload
- Audit log viewer
- Token management
- Comms / notification management

### Portal (`@atlas/portal`)

**Audience:** End users within a tenant
**Auth:** OIDC via Keycloak, standard user role
**Scope:** Read-heavy, interaction-heavy; consumes content, earns badges

Surfaces include:
- Dashboard (configurable widget grid)
- Profile and settings
- Content pages (render tree viewer)
- Announcements widget
- Badges display
- Points history
- Messaging widget

### Public Renderer (`@atlas/public`)

**Audience:** Unauthenticated visitors
**Auth:** None (or scoped public tokens for rate limiting)
**Scope:** Read-only; renders published public pages and media

Surfaces include:
- Public page renderer (render tree → DOM)
- Public media viewer
- Minimal chrome (no navigation, no auth UI)

### Platform Control (`@atlas/platform-control`)

**Audience:** Platform operators (super-admin, SRE)
**Auth:** OIDC + elevated privileges, MFA required
**Scope:** Cross-tenant operations, platform configuration

Surfaces include:
- Tenant management (create, suspend, configure)
- UI bundle management (publish, deprecate, assign)
- Schema registry browser
- Global policy editor
- Platform health dashboard
- Migration and seed management

## The Component System: `@atlas/core`

Atlas frontends use a custom component system instead of a framework. This is intentional — we own every layer of the rendering stack so that `data-testid`, telemetry, and ARIA attributes are enforced structurally, not by convention.

### Rendering: Tagged Template Literals

Templates use the `html` tagged template literal. No JSX, no build-time transform, no virtual DOM.

```js
import { html } from '@atlas/core';

html`<section data-testid="admin.content.pages-list.state-success">
  <h1>Content Pages</h1>
  <button
    data-testid="admin.content.pages-list.create-button"
    @click=${this.handleCreate}>
    Create page
  </button>
</section>`;
```

The `html` tag provides:
- **Auto-escaping** of interpolated values (no raw innerHTML injection)
- **Event binding** via `@event` syntax (`@click`, `@submit`, `@input`)
- **Property binding** via `.prop` syntax (`.rows=${data}`)
- **Efficient DOM updates** — only the changed interpolation points are patched, not the whole template

### Reactivity: Signals

State management uses fine-grained signals. When a signal's value changes, only the DOM nodes that read that signal update. No diffing, no reconciliation.

```js
import { signal, computed, effect } from '@atlas/core';

const pages = signal([]);
const count = computed(() => pages.value.length);

effect(() => {
  console.log(`Page count: ${count.value}`);
});

pages.set([{ id: 'pg_01', title: 'Welcome' }]);
// effect runs, logs "Page count: 1"
// only the DOM node showing the count re-renders
```

### Components

Components are classes that extend `Component`. They declare a `surfaceId`, own signals for state, and implement a `render()` method that returns an `html` template.

```js
import { Component, html, signal } from '@atlas/core';

export class PagesList extends Component {
  static surfaceId = 'admin.content.pages-list';

  pages = signal([]);
  loading = signal(true);
  error = signal(null);

  async onMount() {
    try {
      const data = await this.api.get('/api/v1/pages');
      this.pages.set(data);
    } catch (err) {
      this.error.set(err);
    } finally {
      this.loading.set(false);
    }
  }

  render() {
    if (this.loading.value) {
      return html`<div data-testid="${this.testId}.state-loading" aria-busy="true">
        <atlas-skeleton rows="5" />
      </div>`;
    }

    if (this.error.value) {
      return html`<div data-testid="${this.testId}.state-error" role="alert">
        <p>Failed to load pages.</p>
        <button @click=${() => this.onMount()}>Retry</button>
      </div>`;
    }

    if (this.pages.value.length === 0) {
      return html`<div data-testid="${this.testId}.state-empty">
        <p>No pages yet. Create your first page.</p>
        <button
          data-testid="${this.testId}.create-button"
          @click=${this.handleCreate}>
          Create page
        </button>
      </div>`;
    }

    return html`<section data-testid="${this.testId}.state-success">
      <h1>Content Pages</h1>
      <button
        data-testid="${this.testId}.create-button"
        @click=${() => this.emit('admin.content.pages-list.create-clicked')}>
        Create page
      </button>
      <atlas-table
        data-testid="${this.testId}.table"
        .rows=${this.pages.value}
        .columns=${this.columns}
        aria-label="Content pages" />
    </section>`;
  }
}
```

### Lifecycle

| Method | When |
|--------|------|
| `onMount()` | Component is inserted into the DOM |
| `onUnmount()` | Component is removed from the DOM |
| `render()` | Called on mount and whenever a signal read during render changes |

### Routing

`@atlas/core` includes a client-side router based on the History API:

```js
import { Router } from '@atlas/core';

const router = new Router({
  routes: [
    { path: '/admin/content/pages', component: PagesList, guard: requireRole('admin') },
    { path: '/admin/content/pages/:pageId', component: PageEditor, guard: requireRole('admin') },
    { path: '/admin/badges', component: BadgesList, guard: requireRole('admin') },
  ],
  notFound: NotFoundPage,
});
```

Route guards check auth/permissions before rendering. Lazy loading via dynamic `import()`.

### Data Fetching

`@atlas/core` provides `query()` for cached, deduplicated data fetching:

```js
import { query } from '@atlas/core';

const pages = query('/api/v1/pages', {
  staleTime: 30_000,        // serve from cache for 30s
  refetchOnFocus: true,     // refetch when tab regains focus
});

// pages.data    — signal with the response
// pages.loading — signal (boolean)
// pages.error   — signal (Error | null)
// pages.refetch() — manual refetch
```

## Non-Blocking UI Guarantee

Atlas enforces non-blocking UI **structurally**, not by convention. The component system makes it difficult to write code that blocks the main thread.

### The Constraint

`render()` is **synchronous and must be fast**. It reads signal values and returns a template. That's it. No `await`, no loops over large datasets, no DOM measurement, no computation. The `html` template engine patches only the changed interpolation points — `render()` itself does minimal work.

All async and expensive work happens **outside of render** in designated zones:

| Zone | Where | Blocking? |
|------|-------|-----------|
| `render()` | Template + signal reads | MUST be synchronous, MUST be fast |
| `onMount()` / `onUnmount()` | Lifecycle hooks | May be async (awaits are fine) |
| `effect()` | Reactive side effects | May be async, scheduled by the signal runtime |
| `query()` / `mutate()` | Data fetching | Always async, returns signals for loading/data/error |
| `offload()` | Web Worker delegation | Moves heavy computation off the main thread |
| `channel.on()` | Server event handlers | Async, processes events in microtask queue |

### `offload()` — Web Worker Delegation

For computation that cannot be instant (sorting 10k rows, transforming a large render tree, CSV parsing for import), `@atlas/core` provides `offload()`:

```js
import { offload } from '@atlas/core';

// Runs in a Web Worker — main thread stays responsive
const sorted = await offload(() => expensiveSort(items));
this.pages.set(sorted);
```

`offload()` serializes the function and input, runs it in a pooled Web Worker, and returns a promise. The main thread never blocks. For import/export features that process large files, this is mandatory.

### Structural Enforcement

The non-blocking guarantee is enforced at multiple levels:

1. **`render()` is synchronous by design.** The `Component` base class calls `render()` synchronously during signal updates. Returning a promise from `render()` is a runtime error.
2. **ESLint rules.** `@atlas/eslint-config` flags:
   - `await` expressions inside `render()` methods
   - Synchronous loops over collections larger than a configurable threshold inside `render()`
   - Direct DOM queries (`querySelector`, `getBoundingClientRect`) inside `render()`
   - `XMLHttpRequest` or synchronous `fetch` patterns anywhere
3. **`offload()` for heavy work.** The existence of `offload()` makes the right pattern easier than the wrong one.
4. **`query()` returns signals.** Data fetching never blocks — it returns `{ data, loading, error }` signals immediately. The component renders loading/error/success states reactively.

### Why This Matters

Atlas is an enterprise platform used in low-bandwidth, high-latency environments (field offices, mobile devices on VPN). A blocked main thread means:
- Buttons don't respond to clicks
- Scroll jank
- Screen readers lose track of focus
- The user thinks the app is frozen

The non-blocking guarantee means the UI is always responsive, even while loading data, processing events, or handling large datasets.

## Event-Driven Architecture

The frontend is **signal and event driven** end-to-end. Data does not flow through imperative fetch-then-set patterns. Instead:

1. **User actions** produce events (clicks, form submissions, navigation).
2. **Events** trigger intents (API calls with correlationIds).
3. **API responses** update signals (via `query()` cache or direct `.set()`).
4. **Server events** push updates to signals (via SSE/WebSocket channels).
5. **Signal changes** automatically re-render only the affected DOM nodes.

```
User Action → Event → Intent (API call) → Signal Update → DOM Patch
                                              ↑
                            Server Event ─────┘
```

No component manually polls for updates. No component imperatively fetches and sets state in a sequence. The entire UI is a reactive function of its signals, and signals are fed by both user actions and server events.

### Event Flow Example: Creating a Page

```
1. User clicks "Create page" button
   → telemetry event: admin.content.pages-list.create-clicked
   → correlationId generated

2. User fills form and submits
   → mutate('/api/v1/intents', { action: 'Content.Page.Create', ... })
   → correlationId sent as X-Correlation-Id header
   → telemetry event: admin.content.page-editor.form-submitted

3. API responds 202 Accepted
   → telemetry event: admin.content.page-editor.api-responded (success)
   → UI shows "Page created" toast

4. Server event arrives via SSE:
   { type: 'projection.updated', resource: 'page', id: 'pg_01' }
   → query('/api/v1/pages') cache invalidated
   → pages list re-fetches automatically
   → signal updates, DOM patches, new page appears in table

5. Server event arrives via SSE:
   { type: 'render-tree.ready', pageId: 'pg_01' }
   → if page-viewer is mounted, render tree query re-fetches
```

The user never has to refresh. The admin who creates a page sees it appear. A portal user viewing the dashboard sees the new page arrive. This is the natural consequence of server events + reactive signals.

## Server Event Channels

Atlas uses **two-way event flow**: the client sends commands via HTTP POST; the server pushes events via **Server-Sent Events (SSE)** by default, with **WebSocket** available for features that need full duplex.

### SSE (Default)

SSE is the default server-to-client push mechanism. It is:
- Simple (just HTTP with `text/event-stream`)
- Auto-reconnecting (built into the `EventSource` API)
- Proxy/CDN-friendly (works over HTTP/2)
- Aligned with the backend's event-sourced architecture (the server already produces domain events)

```js
import { channel } from '@atlas/core';

// Connect to the tenant-scoped event stream
const events = channel('/api/v1/events', { transport: 'sse' });

// Subscribe to specific event types
events.on('projection.updated', (event) => {
  // Invalidate the relevant query cache
  queryCache.invalidate(event.resource);
});

events.on('cache.invalidated', (event) => {
  // Re-fetch queries matching the invalidated tags
  queryCache.invalidateByTags(event.tags);
});

events.on('render-tree.ready', (event) => {
  // Update render tree signal if the viewer is mounted
  renderTree.refetch();
});
```

The `channel()` API returns a typed event emitter backed by `EventSource`. It:
- Automatically includes auth tokens (via cookie or query param)
- Includes `tenantId` context
- Reconnects on failure with exponential backoff
- Emits connection status as a signal (`events.connected`)
- Logs all received events to telemetry

### WebSocket (Opt-In)

WebSocket is available for features that need **bidirectional real-time** communication:
- **Messaging widget** — send and receive messages in real-time
- **Collaborative editing** — cursor positions, live edits (future)
- **Live dashboards** — high-frequency metric updates

```js
import { channel } from '@atlas/core';

// WebSocket channel for messaging
const messaging = channel('/ws/messaging', {
  transport: 'ws',
  heartbeatInterval: 30_000,
  reconnect: true,
});

// Receive messages
messaging.on('message.received', (msg) => {
  messages.set([...messages.value, msg]);
});

// Send messages (bidirectional — only available with 'ws' transport)
messaging.send('message.send', { text: 'Hello', channelId: 'ch_01' });
```

### When to Use Which

| Transport | Use When | Examples |
|-----------|----------|---------|
| **SSE** | Server pushes updates, client sends commands via normal HTTP | Projection updates, cache invalidation, render tree ready, badge awarded, notification received |
| **WebSocket** | Both sides send frequent messages, low-latency bidirectional | Messaging widget, collaborative editing, live cursor positions |

**Default to SSE.** Only use WebSocket when the feature genuinely needs the client to push high-frequency data to the server outside of normal HTTP requests.

### Channel and Signal Integration

Server events feed directly into the signal graph. When a server event arrives, it can:
- Invalidate a `query()` cache (triggering automatic re-fetch)
- Update a signal directly (triggering DOM patch)
- Trigger an `effect()` (e.g., show a toast notification)

```js
import { channel, query, effect } from '@atlas/core';

const events = channel('/api/v1/events', { transport: 'sse' });
const pages = query('/api/v1/pages', { staleTime: 30_000 });

// Server event automatically keeps the query fresh
events.on('projection.updated', (e) => {
  if (e.resource === 'page') {
    pages.refetch();  // signal updates → DOM patches
  }
});

// Show a toast when a badge is awarded
effect(() => {
  events.on('badge.awarded', (e) => {
    toast.show(`You earned: ${e.badgeName}`, { severity: 'success' });
  });
});
```

This means the UI is always live. No polling. No manual refresh. The backend's event-sourced architecture flows all the way to the DOM.

## What Is Shared vs. App-Specific

### Shared (`@atlas/platform`)

Everything that enforces correctness, consistency, or convention across all frontends:

| Package | Contents |
|---------|----------|
| `@atlas/core` | Component system, `html` templates, signals, router, `query()`, `channel()`, `offload()`, context |
| `@atlas/design` | Design tokens, primitive components (Button, Input, Table, Dialog, etc.) |
| `@atlas/contracts` | Surface contract shape definitions, validators |
| `@atlas/telemetry` | Event emitters, correlation ID propagation, `surfaceId` context |
| `@atlas/test-ids` | `testId()` helper, naming convention enforcement |
| `@atlas/test-fixtures` | Playwright page objects, fixtures, assertion helpers |
| `@atlas/auth` | OIDC client, session management, role guards, principal context |
| `@atlas/api-client` | Typed HTTP client with tenant context, correlation IDs, error normalization |
| `@atlas/a11y` | Shared a11y utilities (live region announcer, focus management, skip links) |
| `@atlas/errors` | Error boundary components, error state rendering, retry patterns |
| `@atlas/loading` | Skeleton components, loading state rendering |
| `@atlas/shell` | Shared shell primitives (layout slots, nav patterns, breadcrumbs) |

### App-Specific

Each frontend owns:

- **App shell**: Layout, navigation, top-level routing
- **Feature modules**: The actual pages and widgets for that app's domain
- **App-level config**: Environment-specific settings, feature flags
- **App-level Playwright tests**: End-to-end scenarios specific to that app

## Monorepo Package Boundaries

```
frontend/
├── packages/
│   ├── core/            @atlas/core
│   ├── design/          @atlas/design
│   ├── contracts/       @atlas/contracts
│   ├── telemetry/       @atlas/telemetry
│   ├── test-ids/        @atlas/test-ids
│   ├── test-fixtures/   @atlas/test-fixtures
│   ├── auth/            @atlas/auth
│   ├── api-client/      @atlas/api-client
│   ├── a11y/            @atlas/a11y
│   ├── errors/          @atlas/errors
│   ├── loading/         @atlas/loading
│   └── shell/           @atlas/shell
├── apps/
│   ├── admin/           @atlas/admin
│   ├── portal/          @atlas/portal
│   ├── public/          @atlas/public
│   └── platform-control/ @atlas/platform-control
└── tests/
    └── e2e/             Cross-app Playwright suites
```

See [repo-structure.md](./repo-structure.md) for the full directory tree.

## Routing and Surface Ownership

Each app owns its own route namespace. There is no cross-app routing.

| App | Base Path | Example Routes |
|-----|-----------|----------------|
| Admin Console | `/admin` | `/admin/content/pages`, `/admin/badges`, `/admin/audit` |
| Portal | `/` | `/dashboard`, `/profile`, `/pages/:pageId`, `/badges` |
| Public Renderer | `/p` | `/p/:tenantSlug/:pageSlug` |
| Platform Control | `/platform` | `/platform/tenants`, `/platform/bundles`, `/platform/schemas` |

### Surface Ownership Rules

1. A surface is owned by exactly one app.
2. A surface's `surfaceId` encodes which app owns it (e.g., `admin.content.pages.list`).
3. If two apps need similar functionality, the shared logic goes in a platform package; the surface definitions remain separate.
4. Cross-app navigation uses full URLs (no shared router state).

## Feature Slice Structure

A **feature slice** is a vertical cut through one feature within one app. It contains everything needed for that feature to work:

```
apps/admin/src/features/content-pages/
├── contracts/
│   └── pages-list.surface.js        # Surface contract
├── components/
│   ├── PagesListPage.js              # Page component
│   ├── PageEditor.js                 # Editor component
│   └── PageRow.js                    # Table row component
├── hooks/
│   └── usePages.js                   # Data fetching (query wrappers)
├── __tests__/
│   └── pages-list.spec.js           # Playwright tests
└── index.js                          # Public exports
```

### Rules for Feature Slices

- A feature slice MUST NOT import from another feature slice directly.
- Cross-feature communication goes through the API client or shared state (e.g., route params).
- A feature slice MAY import from any `@atlas/*` platform package.
- A feature slice MUST have a surface contract before implementation begins.
- A feature slice MUST have Playwright coverage before it is considered complete.

## SSR Concerns

Atlas frontends are **SPAs** served from a CDN or static file server. There is no server-side rendering layer in the initial architecture.

Rationale:
- The backend API (Ingress) already handles all data fetching, auth, and tenant resolution.
- Adding an SSR layer introduces a second server to operate and secure.
- The Public Renderer is the only app where SSR might matter for SEO; this can be addressed later with pre-rendering or a lightweight edge function.
- WASM-generated render trees are already structured data, not HTML — the frontend's job is purely to render them.

If SSR becomes necessary:
- The `html` tagged template literal can be adapted to produce HTML strings for server rendering.
- The signal/component system has no browser-API dependency in its core — it can run in Node.
- This decision is recorded in [ADR-001](./adr-001-four-frontends-shared-platform.md).

## Avoiding Bad Coupling

### The Two Traps

**Trap 1: Over-sharing.** Putting feature logic in shared packages because "the other app might need it." This creates false dependencies and forces all apps to upgrade together.

**Trap 2: Under-sharing.** Duplicating auth, telemetry, and design code across apps because "we don't want coupling." This creates drift and inconsistency.

### The Rule

**Share infrastructure. Never share features.**

- If it enforces correctness (auth, telemetry, test IDs, error boundaries): **shared platform package**.
- If it renders domain-specific UI (badge editor, audit log table, page editor): **feature slice in the owning app**.
- If two apps need the same domain UI, extract the _data logic_ into a shared query wrapper or API client method, but keep the _components_ in each app's feature slice. The surfaces will diverge over time (admin sees edit controls, portal sees read-only views) and that is correct.

### Dependency Direction

```
Feature Slices → App Shell → Shared Platform → @atlas/core → No deps
     ↓               ↓              ↓               ↓
  (never)         (never)       (never)          (never)
     ←               ←              ←               ←
```

Dependencies flow downward only. A platform package MUST NOT import from any app. An app shell MUST NOT import from feature slices (it routes to them). Feature slices MUST NOT import from each other.
