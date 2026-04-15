# Frontend Constitution

This document defines the hard rules for all Atlas frontend code. These rules are **non-negotiable**. They apply to all 4 frontends and all shared platform packages. Violation of a MUST or MUST NOT rule is a blocking defect.

The key words MUST, MUST NOT, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as defined in RFC 2119.

---

## C1: Surface Contracts

**C1.1** Every page, widget, and dialog MUST have a surface contract before implementation begins.

**C1.2** A surface contract MUST define: `surfaceId`, `route` (if routable), `purpose`, `auth`, `states`, `elements`, `intents`, `telemetryEvents`, `testIds`, `a11y`, and `acceptanceScenarios`.

**C1.3** A surface contract MUST NOT be modified without updating the corresponding Playwright tests.

**C1.4** Surface contracts MUST be the single source of truth for test IDs and telemetry event names used by a surface.

---

## C2: Stable Test IDs

**C2.1** Every interactive element (button, link, input, select, checkbox, radio, toggle, tab, menu item) MUST have a `data-testid` attribute.

**C2.2** Every container that represents a distinct UI region (page, widget, dialog, panel, list, table) MUST have a `data-testid` attribute.

**C2.3** `data-testid` values MUST follow the naming convention: `{surfaceId}.{elementName}` using dot-separated lowercase kebab segments.

Examples:
```
data-testid="admin.content.pages-list.create-button"
data-testid="admin.content.pages-list.search-input"
data-testid="admin.content.pages-list.table"
data-testid="admin.content.pages-list.row.{pageId}"
data-testid="admin.content.pages-list.empty-state"
```

**C2.4** `data-testid` values MUST NOT be changed without a versioned migration in the surface contract.

**C2.5** `data-testid` values MUST NOT be dynamically generated from user content. Parameterized IDs use entity identifiers (e.g., `row.{pageId}`), not user-facing strings.

**C2.6** `data-testid` values MUST NOT be used for styling. They exist for testing and automation only.

---

## C3: Semantic Accessibility

**C3.1** Every `<button>` MUST have an accessible name via visible text content, `aria-label`, or `aria-labelledby`.

**C3.2** Every `<input>`, `<select>`, and `<textarea>` MUST have a visible `<label>` element associated via `for`/`id` pairing.

**C3.3** Every form MUST use a `<form>` element with a submit handler. Form submission MUST NOT be handled via click handlers on non-button elements.

**C3.4** Every modal dialog MUST use `<dialog>` or `role="dialog"` with `aria-modal="true"`, MUST trap focus, and MUST return focus to the trigger element on close.

**C3.5** Every data table MUST use `<table>` with `<thead>`, `<th scope="col">` or `<th scope="row">` as appropriate.

**C3.6** Navigation regions MUST use `<nav>` with a unique `aria-label` when multiple `<nav>` elements exist on the same page.

**C3.7** Page content MUST use landmark elements (`<main>`, `<header>`, `<footer>`, `<aside>`) appropriately. There MUST be exactly one `<main>` element per page.

**C3.8** Error messages MUST be associated with their form fields via `aria-describedby` AND announced to screen readers via `aria-live="polite"` or `role="alert"`.

**C3.9** Loading states MUST be announced to assistive technology via `aria-busy="true"` on the loading region and an `aria-live` announcement when loading completes.

**C3.10** All interactive elements MUST be keyboard-accessible. Custom interactive components MUST support the expected keyboard patterns defined in WAI-ARIA Authoring Practices.

**C3.11** Color MUST NOT be the sole means of conveying information. Status indicators MUST include text or iconography in addition to color.

**C3.12** Focus MUST be visibly indicated. The default browser focus ring MUST NOT be removed without providing an equivalent or better visible focus indicator.

---

## C4: Required Render States

**C4.1** Every surface MUST handle and render these states:

| State | Requirement |
|-------|-------------|
| **Loading** | Skeleton or spinner with `aria-busy="true"`. MUST NOT show stale data as current. |
| **Empty** | Explicit empty state with guidance (e.g., "No pages yet. Create your first page."). MUST NOT show a blank region. |
| **Success** | Primary content rendered with all required test IDs and telemetry hooks. |
| **Validation Error** | Field-level errors associated via `aria-describedby`. Summary if >3 errors. |
| **Backend Error** | User-facing error with retry affordance. Error details logged to telemetry, not shown raw to user. |
| **Unauthorized** | If the surface has auth requirements, MUST show an appropriate message or redirect — not a blank page or cryptic error. |

**C4.2** Each state MUST have a corresponding `data-testid` on its root container:
```
data-testid="{surfaceId}.state-loading"
data-testid="{surfaceId}.state-empty"
data-testid="{surfaceId}.state-success"
data-testid="{surfaceId}.state-error"
data-testid="{surfaceId}.state-unauthorized"
```

**C4.3** Validation errors MUST NOT use `alert` role for individual field errors. Use `aria-describedby` for field association and `role="alert"` only for the summary.

---

## C5: Telemetry Hooks

**C5.1** Every interactive element MUST emit a telemetry event on user interaction (click, submit, toggle, navigate).

**C5.2** Every telemetry event MUST include: `eventName`, `surfaceId`, `componentId`, `correlationId`, `timestamp`, and `outcome`.

**C5.3** Every intent submitted to the backend MUST carry a `correlationId` generated on the frontend and included in both the API request header (`X-Correlation-Id`) and the telemetry event.

**C5.4** `correlationId` MUST be a UUIDv4 generated at the point of user action, before the API call is made.

**C5.5** Telemetry events MUST NOT contain PII (names, emails, free-text input values). Use entity IDs and action descriptors only.

**C5.6** Telemetry event names MUST follow the convention: `{app}.{module}.{surface}.{action}`.

Examples:
```
admin.content.pages-list.create-clicked
admin.content.pages-list.search-submitted
admin.content.pages-list.row-deleted
portal.dashboard.widget.expanded
```

---

## C6: Correlation IDs

**C6.1** The frontend MUST generate a `correlationId` (UUIDv4) for every user-initiated action that results in an API call.

**C6.2** The `correlationId` MUST be sent as the `X-Correlation-Id` HTTP header on the API request.

**C6.3** The same `correlationId` MUST be included in the telemetry event emitted for that action.

**C6.4** If a user action triggers multiple API calls, all calls MUST share the same `correlationId`.

**C6.5** The `correlationId` MUST be logged with any frontend error associated with that action.

---

## C7: Error and Loading Handling

**C7.1** Every API call MUST be wrapped in error handling that renders a user-facing error state — not an unhandled exception or blank screen.

**C7.2** Network errors MUST be distinguished from application errors (4xx vs. 5xx vs. offline) and rendered with appropriate messaging.

**C7.3** Loading states MUST appear within 100ms of initiating a data fetch. MUST NOT show a flash of empty content before the loading state.

**C7.4** Error boundaries MUST be placed at the surface level. A failing widget MUST NOT crash the entire page.

**C7.5** Retry affordances MUST be provided for transient errors (network failures, 5xx responses). The retry MUST reuse the original `correlationId`.

---

## C8: No Uninstrumented UI

**C8.1** Every interactive element MUST have both a `data-testid` AND a telemetry event handler. There MUST be no interactive element that is invisible to both testing and observability.

**C8.2** Every page navigation MUST emit a `{app}.navigation.page-viewed` telemetry event with the `surfaceId` of the destination.

**C8.3** Every API call MUST be observable: the API client MUST emit timing telemetry for every request (method, path, status, duration, correlationId).

---

## C9: No Feature Without Playwright Coverage

**C9.1** A surface MUST NOT be merged without Playwright tests covering all states defined in C4.1.

**C9.2** Playwright tests MUST use the selector strategy defined in [testing-strategy.md](./testing-strategy.md): semantic locators first, `data-testid` always available as fallback.

**C9.3** Playwright tests MUST assert telemetry events were emitted for key interactions (via a telemetry spy fixture).

**C9.4** Playwright tests MUST run in CI on every pull request that modifies frontend code.

---

## C10: No Page/Widget Without a Surface Contract

**C10.1** A pull request that adds a new page or widget MUST include the surface contract file.

**C10.2** The surface contract MUST be reviewed and approved before implementation is merged.

**C10.3** If a surface contract changes, the corresponding Playwright tests MUST be updated in the same pull request.

---

## C11: Component Usage

**C11.1** Feature code MUST use `@atlas/design` primitives (built on `@atlas/core`) for interactive elements (`<atlas-button>`, `<atlas-input>`, `<atlas-select>`, `<atlas-dialog>`, `<atlas-table>`, etc.) rather than raw HTML elements.

**C11.2** `@atlas/design` primitives MUST enforce C2 (test IDs), C3 (a11y), and C5 (telemetry) requirements automatically. A correctly-used primitive MUST NOT require the feature developer to manually add `data-testid`, `aria-*`, or telemetry hooks for standard interactions.

**C11.3** If a feature needs a component not available in `@atlas/design`, the developer MUST either add it to `@atlas/design` (if it is reusable) or build it in the feature slice as a `Component` subclass with full C2/C3/C5 compliance documented in a code comment.

**C11.4** All components MUST extend `@atlas/core` `Component`. Direct DOM manipulation outside of `render()` and lifecycle hooks is NOT permitted except in `@atlas/core` internals.

---

## C12: Security

**C12.1** Auth tokens MUST NOT be stored in `localStorage`. Use `httpOnly` cookies or in-memory storage with refresh token rotation.

**C12.2** All API calls MUST go through `@atlas/api-client`. Direct `fetch` or `XMLHttpRequest` calls MUST NOT be used in feature code.

**C12.3** User-generated content MUST be rendered via `@atlas/core`'s `html` tagged template literal, which auto-escapes interpolated values. Direct assignment to `innerHTML` MUST NOT be used in feature code.

**C12.4** URLs from user content MUST be validated against allowed schemes (`https:`, `mailto:`) before rendering as links.

---

## C13: Non-Blocking UI

**C13.1** `render()` MUST be synchronous. Returning a promise from `render()` is a runtime error. `render()` MUST only read signal values and return an `html` template.

**C13.2** `await` expressions MUST NOT appear inside `render()` methods. This is enforced by ESLint.

**C13.3** Synchronous loops over collections inside `render()` MUST NOT perform computation — only template construction. Sorting, filtering, and transformation MUST happen in `computed()` signals or `effect()` hooks, not inline in `render()`.

**C13.4** Direct DOM queries (`querySelector`, `getBoundingClientRect`, `getComputedStyle`, `offsetHeight`) MUST NOT be used inside `render()`. If DOM measurement is required, it MUST be done in `onMount()` or a post-render `effect()`.

**C13.5** Heavy computation (sorting >1000 items, parsing files, transforming large datasets) MUST be offloaded to a Web Worker via `offload()`. Performing expensive synchronous work on the main thread is a blocking defect.

**C13.6** `XMLHttpRequest` with `async: false` (synchronous XHR) MUST NOT be used anywhere in the codebase. This is enforced by ESLint.

**C13.7** `alert()`, `confirm()`, and `prompt()` MUST NOT be used. These block the main thread. Use `<atlas-dialog>` for confirmations and `<atlas-toast>` for notifications.

---

## C14: Event-Driven Data Flow

**C14.1** Components MUST NOT imperatively fetch-then-set data in sequences. Data fetching MUST go through `query()` or `mutate()`, which return signals. Components render reactively from those signals.

**C14.2** Components MUST NOT poll for updates using `setInterval` or `setTimeout` loops. Server-initiated updates MUST arrive via `channel()` (SSE or WebSocket), which invalidates the relevant `query()` cache or updates signals directly.

**C14.3** Cross-component communication MUST NOT use direct method calls, shared mutable objects, or global variables. Components communicate through: signals, the `query()` cache, route parameters, or the server event `channel()`.

**C14.4** Side effects (toasts, navigation, analytics) MUST be triggered via `effect()` reacting to signal changes, not imperatively inlined after API calls.

---

## C15: Server Event Channels

**C15.1** Every frontend app that displays data which can change server-side MUST connect to the server event channel via `channel()`.

**C15.2** SSE (`transport: 'sse'`) MUST be the default transport. WebSocket (`transport: 'ws'`) MUST only be used for features that require bidirectional real-time communication (messaging, collaborative editing).

**C15.3** Server event handlers MUST NOT directly mutate DOM. They MUST update signals or invalidate `query()` caches, letting the reactive system handle re-rendering.

**C15.4** The `channel()` connection MUST include `tenantId` context and authentication credentials. Unauthenticated event streams MUST NOT be used except in the Public Renderer for public-scoped events.

**C15.5** `channel()` MUST reconnect automatically on disconnection with exponential backoff. The connection status MUST be exposed as a signal (`channel.connected`) so the UI can display connectivity state.

**C15.6** All events received via `channel()` MUST be logged to telemetry with the event type and a timestamp. This enables debugging of event delivery issues.
