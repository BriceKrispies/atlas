# Surface Contracts

## What Is a Surface

A **surface** is a bounded, independently testable UI region. Surfaces come in three kinds:

| Kind | Description | Example |
|------|-------------|---------|
| **Page** | A routable, full-page surface | Pages list, Badge editor, Audit log |
| **Widget** | An embeddable region within a page | Announcements widget, Points summary |
| **Dialog** | A modal or drawer triggered by user action | Create page dialog, Confirm delete |

Every surface has a **surface contract** — a structured specification that defines everything needed to implement, test, and instrument it.

## Why Surface Contracts Exist

1. **They are the spec for AI agents.** An agent reads the contract and knows exactly what to build, test, and instrument.
2. **They make test IDs stable.** Test IDs are defined in the contract, not invented during implementation.
3. **They enforce completeness.** Every state, element, and telemetry event is declared upfront.
4. **They are reviewable artifacts.** The contract is reviewed before implementation begins.

## Surface Contract Structure

Every surface contract MUST include all of the following fields.

### Required Fields

```javascript
/**
 * @typedef {Object} SurfaceContract
 * @property {string} surfaceId — Unique identifier. Format: {app}.{module}.{surfaceName}
 * @property {"page"|"widget"|"dialog"} kind — Surface kind
 * @property {string} [route] — URL path (pages only, omit for widgets/dialogs)
 * @property {string} purpose — One-sentence purpose
 * @property {AuthSpec} auth — Auth and role requirements
 * @property {StatesSpec} states — All states this surface can be in
 * @property {ElementSpec[]} elements — Interactive and structural elements with test IDs
 * @property {IntentSpec[]} intents — User intents this surface can trigger
 * @property {TelemetryEventSpec[]} telemetryEvents — Telemetry events emitted
 * @property {Object<string,string>} testIds — Stable test IDs (derived from elements + states)
 * @property {A11ySpec} a11y — Accessibility requirements
 * @property {ChannelSubscription[]} [channelEvents] — Server events this surface reacts to
 * @property {AcceptanceScenario[]} acceptanceScenarios — Acceptance scenarios for Playwright
 */

/**
 * @typedef {Object} ChannelSubscription
 * @property {string} eventType — Server event type to subscribe to
 * @property {"sse"|"ws"} transport — Which transport (default: sse)
 * @property {string} reaction — What happens when this event arrives (e.g., "invalidate pages query", "append to messages signal")
 */

/**
 * @typedef {Object} AuthSpec
 * @property {boolean} required — Is authentication required?
 * @property {string[]} roles — Minimum role(s) required
 * @property {string[]} permissions — Specific action permissions required
 */

/**
 * @typedef {Object} StatesSpec
 * @property {StateSpec} loading
 * @property {StateSpec} [empty] — Required for list/collection surfaces
 * @property {StateSpec} success
 * @property {StateSpec} [validationError] — Required for form surfaces
 * @property {StateSpec} backendError
 * @property {StateSpec} [unauthorized] — Required if auth.required is true
 */
```

### Field Definitions

```javascript
/**
 * @typedef {Object} StateSpec
 * @property {string} description — What the user sees in this state
 * @property {string} testId — Test ID for the state container
 */

/**
 * @typedef {Object} ElementSpec
 * @property {string} name — Element name (used in test ID)
 * @property {"atlas-button"|"atlas-input"|"atlas-select"|"atlas-checkbox"|"atlas-toggle"|"atlas-link"|"atlas-table"|"atlas-row"|"atlas-table-head"|"atlas-table-body"|"atlas-table-cell"|"atlas-box"|"atlas-text"|"atlas-heading"|"atlas-stack"|"atlas-skeleton"|"atlas-badge"|"atlas-nav"|"atlas-nav-item"|"atlas-dialog"} type
 * @property {string} testId — Full test ID: {surfaceId}.{name}
 * @property {string} purpose — What this element does
 * @property {boolean} [parameterized] — Is this element parameterized? (e.g., row.{id})
 */

/**
 * @typedef {Object} IntentSpec
 * @property {string} intentId — Format: {Module}.{Resource}.{Action}
 * @property {string} trigger — What triggers this intent
 * @property {string} endpoint — API endpoint called
 * @property {"GET"|"POST"|"PUT"|"DELETE"|"PATCH"} method
 */

/**
 * @typedef {Object} TelemetryEventSpec
 * @property {string} eventName — Format: {app}.{module}.{surface}.{action}
 * @property {string} trigger — What triggers this event
 * @property {string[]} properties — Additional properties included
 */

/**
 * @typedef {Object} A11ySpec
 * @property {"main"|"navigation"|"complementary"|"form"|"region"} [landmark]
 * @property {string} ariaLabel — Accessible name for the surface region
 * @property {string[]} keyboardInteractions — Keyboard interactions beyond standard tab/enter
 * @property {string[]} liveAnnouncements — Live region announcements
 */

/**
 * @typedef {Object} AcceptanceScenario
 * @property {string} name — Scenario name
 * @property {string} given
 * @property {string} when
 * @property {string} then
 */
```

## Naming Conventions

### `surfaceId`

Format: `{app}.{module}.{surfaceName}`

- `{app}`: One of `admin`, `portal`, `public`, `platform`
- `{module}`: The Atlas module (e.g., `content`, `badges`, `audit`, `org`, `points`, `comms`, `tokens`, `import`) or `shell` for app-level surfaces
- `{surfaceName}`: Kebab-case name of the surface

Examples:
```
admin.content.pages-list
admin.content.page-editor
admin.badges.badge-form
portal.dashboard.main
portal.content.page-viewer
platform.tenants.tenant-list
```

### `data-testid`

Format: `{surfaceId}.{elementName}`

- `{elementName}`: Kebab-case name of the element within the surface
- For parameterized elements: `{surfaceId}.{elementName}.{entityId}`

Examples:
```
admin.content.pages-list.create-button
admin.content.pages-list.search-input
admin.content.pages-list.row.pg_01ABC
admin.content.page-editor.title-input
admin.content.page-editor.save-button
admin.content.page-editor.state-loading
```

### `intentId`

Format: `{Module}.{Resource}.{Action}`

Matches the backend action vocabulary from Atlas module manifests.

Examples:
```
Content.Page.Create
Content.Page.Update
Content.Page.Delete
Content.Media.Upload
Badges.Badge.Create
Badges.Badge.Award
Audit.History.Export
```

### Telemetry Event Names

Format: `{app}.{module}.{surface}.{action}`

Examples:
```
admin.content.pages-list.create-clicked
admin.content.pages-list.search-submitted
admin.content.pages-list.row-deleted
admin.content.page-editor.saved
admin.content.page-editor.validation-failed
portal.dashboard.main.widget-expanded
```

---

## Example: Complete Surface Contract

### `admin.content.pages-list` — Content Pages List

```yaml
surfaceId: admin.content.pages-list
kind: page
route: /admin/content/pages
purpose: List all content pages for the current tenant with search, sort, and CRUD actions.

auth:
  required: true
  roles: [tenant-admin]
  permissions: [Content.Page.List]

states:
  loading:
    description: Skeleton table with 5 placeholder rows
    testId: admin.content.pages-list.state-loading
  empty:
    description: Empty state illustration with "No pages yet" heading and create button
    testId: admin.content.pages-list.state-empty
  success:
    description: Table of pages with title, slug, status, updated date, and actions column
    testId: admin.content.pages-list.state-success
  backendError:
    description: Error panel with message and retry button
    testId: admin.content.pages-list.state-error
  unauthorized:
    description: "You don't have permission to view pages" message with link to dashboard
    testId: admin.content.pages-list.state-unauthorized

elements:
  - name: create-button
    type: button
    testId: admin.content.pages-list.create-button
    purpose: Opens the create page dialog
  - name: search-input
    type: input
    testId: admin.content.pages-list.search-input
    purpose: Filters pages by title
  - name: table
    type: table
    testId: admin.content.pages-list.table
    purpose: Displays page rows
  - name: row
    type: container
    testId: admin.content.pages-list.row.{pageId}
    purpose: Single page row with actions
    parameterized: true
  - name: row-edit-button
    type: button
    testId: admin.content.pages-list.row-edit.{pageId}
    purpose: Navigate to page editor
    parameterized: true
  - name: row-delete-button
    type: button
    testId: admin.content.pages-list.row-delete.{pageId}
    purpose: Opens delete confirmation dialog
    parameterized: true
  - name: pagination
    type: container
    testId: admin.content.pages-list.pagination
    purpose: Page navigation controls

intents:
  - intentId: Content.Page.Create
    trigger: Submit create page form
    endpoint: /api/v1/intents
    method: POST
  - intentId: Content.Page.Delete
    trigger: Confirm delete dialog
    endpoint: /api/v1/intents
    method: POST

telemetryEvents:
  - eventName: admin.content.pages-list.page-viewed
    trigger: Page mount
    properties: []
  - eventName: admin.content.pages-list.create-clicked
    trigger: Create button clicked
    properties: []
  - eventName: admin.content.pages-list.search-submitted
    trigger: Search input debounced submission
    properties: [queryLength]
  - eventName: admin.content.pages-list.row-edit-clicked
    trigger: Edit button clicked on a row
    properties: [pageId]
  - eventName: admin.content.pages-list.row-delete-clicked
    trigger: Delete button clicked on a row
    properties: [pageId]
  - eventName: admin.content.pages-list.delete-confirmed
    trigger: Delete confirmed in dialog
    properties: [pageId, correlationId]

testIds:
  surface: admin.content.pages-list
  createButton: admin.content.pages-list.create-button
  searchInput: admin.content.pages-list.search-input
  table: admin.content.pages-list.table
  row: admin.content.pages-list.row.{pageId}
  rowEditButton: admin.content.pages-list.row-edit.{pageId}
  rowDeleteButton: admin.content.pages-list.row-delete.{pageId}
  pagination: admin.content.pages-list.pagination
  stateLoading: admin.content.pages-list.state-loading
  stateEmpty: admin.content.pages-list.state-empty
  stateSuccess: admin.content.pages-list.state-success
  stateError: admin.content.pages-list.state-error
  stateUnauthorized: admin.content.pages-list.state-unauthorized

channelEvents:
  - eventType: projection.updated
    transport: sse
    reaction: "When resource='page', invalidate pages query — new/updated pages appear automatically"
  - eventType: page.deleted
    transport: sse
    reaction: "Remove page from local signal, announce 'Page removed by another user' if row was visible"

a11y:
  landmark: main
  ariaLabel: Content pages
  keyboardInteractions:
    - "Enter on row: navigate to page editor"
    - "Delete key on focused row: open delete confirmation"
  liveAnnouncements:
    - "Pages loaded (count)"
    - "Page deleted successfully"
    - "Search results updated (count)"
    - "Error loading pages"

acceptanceScenarios:
  - name: Admin views pages list
    given: Admin is authenticated and has Content.Page.List permission
    when: Admin navigates to /admin/content/pages
    then: Table displays pages with title, slug, status, and updated date

  - name: Admin searches pages
    given: Pages list is displayed with multiple pages
    when: Admin types "welcome" in search input
    then: Table filters to show only pages with "welcome" in the title

  - name: Admin creates a page
    given: Pages list is displayed
    when: Admin clicks create button, fills form, and submits
    then: New page appears in the table and success toast is shown

  - name: Admin deletes a page
    given: Pages list is displayed with at least one page
    when: Admin clicks delete on a row and confirms in dialog
    then: Page is removed from table and "Page deleted" is announced

  - name: Empty state shown when no pages exist
    given: Admin is authenticated and tenant has no pages
    when: Admin navigates to /admin/content/pages
    then: Empty state with "No pages yet" and create button is shown

  - name: Unauthorized user sees permission error
    given: User is authenticated but lacks Content.Page.List permission
    when: User navigates to /admin/content/pages
    then: Unauthorized state is shown with message and redirect link

  - name: Backend error shows retry
    given: Admin is authenticated
    when: API returns 500 error
    then: Error state is shown with retry button; clicking retry re-fetches
```
