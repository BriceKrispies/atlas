# Frontend Observability

## Principles

1. **No uninstrumented UI.** Every interactive element emits telemetry. Every API call is timed. Every navigation is tracked.
2. **Correlation is mandatory.** Every user action that hits the backend carries a `correlationId` that connects the frontend event to the backend trace.
3. **Structured, not ad-hoc.** All telemetry follows a single event schema. No freeform logging.
4. **PII-free.** Telemetry contains entity IDs and action descriptors, never names, emails, or free-text content.

## Telemetry Event Structure

Every frontend telemetry event MUST conform to this schema:

```javascript
/**
 * @typedef {Object} TelemetryEvent
 * @property {string} eventName — Format: {app}.{module}.{surface}.{action}
 * @property {string} surfaceId — Surface that emitted this event
 * @property {string} [componentId] — Component within the surface
 * @property {string} [correlationId] — Links this event to API calls and backend traces
 * @property {string} [intentId] — Intent ID if this triggers a backend intent
 * @property {"initiated"|"success"|"failure"|"cancelled"} outcome
 * @property {string} timestamp — ISO 8601
 * @property {number} [durationMs] — Duration in milliseconds (for timed operations)
 * @property {Object<string, string|number|boolean>} properties — Additional properties
 */
```

### Field Definitions

**`eventName`** — The canonical name of the event. Format: `{app}.{module}.{surface}.{action}`.

The `{action}` segment uses past tense for completed actions and present tense for initiated actions:
- `create-clicked` — user clicked a button (instantaneous)
- `form-submitted` — user submitted a form (initiated)
- `delete-confirmed` — user confirmed a destructive action
- `page-viewed` — user navigated to a page
- `api-responded` — API call completed

**`surfaceId`** — Identifies which surface emitted the event. Matches the surface contract's `surfaceId`.

**`componentId`** — Identifies a specific component within the surface when the surface has multiple interactive regions. Format: `{surfaceId}.{componentName}`.

Example: `admin.content.pages-list.search-input`

**`correlationId`** — A UUIDv4 generated on the frontend at the point of user action. The same ID is sent as `X-Correlation-Id` on the resulting API call. This connects the frontend click to the backend event processing.

**`intentId`** — The Atlas intent ID when this event triggers a backend write operation. Matches the intent vocabulary (e.g., `Content.Page.Create`).

**`outcome`** — What happened:
- `initiated`: Action started (e.g., form submitted, API call in flight)
- `success`: Action completed successfully
- `failure`: Action failed (error, validation failure, permission denied)
- `cancelled`: User cancelled the action (e.g., dismissed confirm dialog)

## Required Telemetry Coverage

### Every Surface MUST Emit

| Event | When | Required Properties |
|-------|------|---------------------|
| `{surfaceId}.page-viewed` | Surface mounts | — |
| `{surfaceId}.{action}` | User interacts with any interactive element | Varies by element |
| `{surfaceId}.api-responded` | API call completes | `method`, `path`, `status`, `durationMs` |
| `{surfaceId}.error-displayed` | Error state rendered | `errorType`, `errorCode` |

### API Client MUST Emit

The `@atlas/api-client` automatically emits timing telemetry for every request:

```javascript
{
  eventName: "{app}.api.request-completed",
  surfaceId: "from calling context",
  correlationId: "from request header",
  outcome: "success" | "failure",
  durationMs: 234,
  properties: {
    method: "POST",
    path: "/api/v1/intents",
    status: 200,
    cached: false
  }
}
```

### Navigation MUST Emit

The app shell automatically emits on every route change:

```javascript
{
  eventName: "{app}.navigation.page-viewed",
  surfaceId: "target surface ID",
  outcome: "success",
  properties: {
    fromSurface: "previous surface ID",
    navigationMethod: "link" | "programmatic" | "browser-back"
  }
}
```

## Correlation ID Flow

```
┌──────────────────────────────────────────────────────────┐
│ User clicks "Create Page"                                │
│                                                          │
│  1. Generate correlationId = "c9f2a1..."                 │
│  2. Emit telemetry: {                                    │
│       eventName: "admin.content.pages-list.create-clicked"│
│       correlationId: "c9f2a1..."                         │
│       outcome: "initiated"                               │
│     }                                                    │
│  3. POST /api/v1/intents                                 │
│       Header: X-Correlation-Id: c9f2a1...                │
│  4. Backend logs with correlationId: c9f2a1...           │
│  5. On response, emit telemetry: {                       │
│       eventName: "admin.content.pages-list.api-responded"│
│       correlationId: "c9f2a1..."                         │
│       outcome: "success"                                 │
│       durationMs: 342                                    │
│     }                                                    │
└──────────────────────────────────────────────────────────┘
```

To debug a user-reported issue:
1. Find the `correlationId` from the frontend telemetry event.
2. Search backend logs/traces for the same `correlationId`.
3. See the full journey: frontend click → ingress → auth → dispatch → event → worker → projection.

## How `surfaceId`, `componentId`, `intentId`, and `correlationId` Flow Through the UI

```
Surface Mount
  → surfaceId set from Component's static surfaceId property
  → page-viewed telemetry emitted with surfaceId

User Clicks Button
  → componentId derived from surfaceId + element name
  → correlationId generated (UUIDv4)
  → click telemetry emitted with surfaceId, componentId, correlationId

API Call Made
  → correlationId sent as X-Correlation-Id header
  → intentId sent in request body (for write operations)
  → api-client emits request telemetry with surfaceId, correlationId

API Response Received
  → response telemetry emitted with surfaceId, correlationId, outcome, duration

Server Event Received (via channel)
  → event logged to telemetry with eventType, timestamp
  → if event carries correlationId, it links back to the originating user action
  → signal updated or query cache invalidated → DOM patches reactively

Error Occurred
  → error telemetry emitted with surfaceId, correlationId, errorType
  → error logged to console with correlationId for debugging
```

## Telemetry Transport

The `@atlas/telemetry` package abstracts the transport layer. Events are:

1. **Buffered** — events queue in memory and flush in batches (every 5 seconds or 10 events, whichever comes first).
2. **Resilient** — if the telemetry endpoint is unreachable, events are stored in `sessionStorage` and retried on next page load.
3. **Non-blocking** — telemetry emission never blocks user interaction or API calls.
4. **Configurable** — transport can be swapped (HTTP POST, WebSocket, console.log for development).

### Development Mode

In development (`ATLAS_ENV=dev`), telemetry events are:
- Logged to browser console in a structured, readable format
- Captured by the `telemetrySpy` Playwright fixture for test assertions
- Not sent to any external endpoint

## Frontend Receipts and Backend Traces

A **frontend receipt** for observability consists of:

1. **Telemetry event log** — all events emitted during a test run, captured by `telemetrySpy`.
2. **Correlation ID chain** — proof that frontend events and backend traces share the same `correlationId`.
3. **API timing data** — request/response timing for all API calls made during the test.
4. **Error telemetry** — any error events emitted, with codes and context.

In Playwright tests, receipts are verified:

```javascript
test('create page emits correct telemetry chain', async ({ page, telemetrySpy }) => {
  await page.goto('/admin/content/pages');

  // Capture the correlationId that will be generated
  await page.getByRole('button', { name: 'Create page' }).click();

  const clickEvent = telemetrySpy.getLatest('admin.content.pages-list.create-clicked');
  expect(clickEvent.correlationId).toBeDefined();
  expect(clickEvent.outcome).toBe('initiated');

  // Fill and submit form...
  await page.getByLabel('Page title').fill('Test Page');
  await page.getByRole('button', { name: 'Save' }).click();

  // Verify API call telemetry uses same correlationId
  const apiEvent = telemetrySpy.getLatest('admin.api.request-completed');
  expect(apiEvent.correlationId).toBe(clickEvent.correlationId);
  expect(apiEvent.outcome).toBe('success');
  expect(apiEvent.durationMs).toBeGreaterThan(0);
});
```
