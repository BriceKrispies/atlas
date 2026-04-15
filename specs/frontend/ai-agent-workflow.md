# AI Agent Workflow

This document defines the exact, sequential workflow an AI agent MUST follow when adding a feature to an Atlas frontend. Deviation from this workflow produces incomplete or non-compliant features.

## Prerequisites

Before starting, the agent MUST have access to:
- The Atlas module spec for the feature's domain (`specs/modules/{module}/`)
- The frontend constitution (`specs/frontend/constitution.md`)
- The surface contract template (`specs/frontend/surface-contract.md`)
- The observability standards (`specs/frontend/observability.md`)
- The accessibility requirements (`specs/frontend/accessibility.md`)

## Workflow: Adding a New Feature

### Step 1: Read Relevant Specs

**Input:** Feature request or task description.
**Action:** Read the module spec, existing surface contracts for the same module, and any related API endpoint documentation.

**Output:** Understanding of:
- What data the feature operates on
- What intents (backend actions) the feature triggers
- What permissions are required
- What existing surfaces relate to this feature

**Do not proceed until you can answer:**
1. Which app does this feature belong to? (admin, portal, public, platform)
2. Which module does this feature belong to? (content, badges, audit, etc.)
3. What is the feature's primary user action?
4. What API endpoints does it call?
5. What permissions gate this feature?

### Step 2: Create or Update Surface Contract

**Input:** Understanding from Step 1.
**Action:** Create a surface contract file at:
```
frontend/apps/{app}/src/features/{module}/{feature}/contracts/{surface-name}.surface.js
```

**The contract MUST define:**
- `surfaceId` following the naming convention `{app}.{module}.{surfaceName}`
- `route` (if this is a page)
- `purpose` (one sentence)
- `auth` requirements (roles and permissions)
- All `states` (loading, empty, success, validationError, backendError, unauthorized as applicable)
- All `elements` with their test IDs
- All `intents` with their API endpoints
- All `telemetryEvents` with their trigger conditions
- All `testIds` (derived from elements and states)
- `a11y` expectations (landmark, aria-label, keyboard interactions, live announcements)
- `acceptanceScenarios` in Given/When/Then format

**Verify:**
- [ ] surfaceId follows convention: `{app}.{module}.{surfaceName}`
- [ ] All test IDs follow convention: `{surfaceId}.{elementName}`
- [ ] All telemetry event names follow convention: `{app}.{module}.{surface}.{action}`
- [ ] All required states have test IDs
- [ ] At least one acceptance scenario per state
- [ ] At least one acceptance scenario per intent
- [ ] Channel subscriptions defined if the surface displays data that can change server-side
- [ ] No polling patterns — server updates come via `channel()`, not `setInterval`

### Step 3: Define Selectors and Telemetry

**Input:** Surface contract from Step 2.
**Action:** Extract the concrete selectors and telemetry events that Playwright tests will use.

Create a checklist:

```
Test IDs to verify:
  ☐ {surfaceId}.state-loading
  ☐ {surfaceId}.state-empty (if list/collection)
  ☐ {surfaceId}.state-success
  ☐ {surfaceId}.state-error
  ☐ {surfaceId}.state-unauthorized (if authed)
  ☐ {surfaceId}.{element1}
  ☐ {surfaceId}.{element2}
  ...

Telemetry events to verify:
  ☐ {app}.{module}.{surface}.page-viewed
  ☐ {app}.{module}.{surface}.{action1}
  ☐ {app}.{module}.{surface}.{action2}
  ...

Semantic locators to use:
  ☐ getByRole('button', { name: '...' }) for {element}
  ☐ getByLabel('...') for {element}
  ☐ getByRole('table', { name: '...' }) for {element}
  ...
```

### Step 4: Write Playwright Tests

**Input:** Surface contract and selector checklist from Steps 2-3.
**Action:** Create Playwright test file at:
```
frontend/apps/{app}/src/features/{module}/{feature}/__tests__/{surface-name}.spec.js
```

**Write tests in this order:**

#### 4a. State Tests
One test per required state:
```javascript
import { atlasTest as test, expect } from '@atlas/test-fixtures';

test.describe('admin.content.pages-list', () => {
  test('renders loading state', async ({ page }) => { ... });
  test('renders empty state', async ({ page }) => { ... });
  test('renders success state', async ({ page }) => { ... });
  test('renders error state on backend failure', async ({ page }) => { ... });
  test('renders unauthorized state without permission', async ({ page }) => { ... });
});
```

#### 4b. Acceptance Scenario Tests
One test per acceptance scenario from the contract:
```javascript
test('admin creates a page', async ({ page }) => {
  // Given: pages list is displayed
  // When: admin clicks create, fills form, submits
  // Then: new page appears in table
});
```

#### 4c. Telemetry Tests
One test per telemetry event:
```javascript
test('emits page-viewed on mount', async ({ page, telemetrySpy }) => {
  await page.goto('/admin/content/pages');
  await expect(telemetrySpy).toHaveEmitted({
    eventName: 'admin.content.pages-list.page-viewed',
    surfaceId: 'admin.content.pages-list',
  });
});
```

#### 4d. Accessibility Test
One axe scan per primary state:
```javascript
test('passes axe accessibility audit', async ({ page }) => {
  // ... setup success state ...
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

**All tests should fail at this point.** This is expected and correct — the implementation doesn't exist yet.

### Step 5: Implement UI with Approved Primitives

**Input:** Failing Playwright tests from Step 4.
**Action:** Implement the surface using `@atlas/design` primitives.

**File structure:**
```
frontend/apps/{app}/src/features/{module}/{feature}/
├── contracts/
│   └── {surface-name}.surface.js     # Already created in Step 2
├── components/
│   ├── {SurfaceName}Page.js           # Main page component (extends Component)
│   └── {SubComponent}.js              # Supporting components
├── hooks/
│   └── use{Resource}.js               # Data fetching (query wrappers)
├── __tests__/
│   └── {surface-name}.spec.js         # Already created in Step 4
└── index.js                           # Public exports
```

**Implementation rules:**
1. Extend `@atlas/core` `Component` for all surface components.
2. Use `@atlas/design` primitives (`<atlas-button>`, `<atlas-table>`, etc.) for all interactive elements.
3. Use `html` tagged template literal for all rendering — never raw `innerHTML`.
4. Set `static surfaceId` on the component class.
5. Use `@atlas/api-client` for all API calls — never raw `fetch`.
6. Use `@atlas/telemetry` `emit()` for custom telemetry events.
7. Add `data-testid` to every element and state container per the contract.
8. Implement all required states (loading, empty, success, error, unauthorized) using signals.
9. Add `aria-*` attributes per the accessibility requirements.
10. Generate `correlationId` before every API call.
11. Subscribe to server events via `channel()` if the surface displays data that can change server-side.
12. Use `offload()` for any heavy computation (sorting >1000 items, parsing files).

**Run tests after implementing each state.** Fix failures before moving to the next state.

### Step 6: Verify Observability and Accessibility

**Input:** Implemented surface with passing tests.
**Action:** Verify the complete receipt.

**Observability checklist:**
- [ ] Page-viewed telemetry emitted on mount
- [ ] Click/submit telemetry emitted for every interactive element
- [ ] API call telemetry emitted with correlationId
- [ ] Error telemetry emitted on failure
- [ ] correlationId consistent across related events

**Accessibility checklist:**
- [ ] axe scan passes with zero violations
- [ ] All form inputs have visible labels
- [ ] All buttons have accessible names
- [ ] Focus order is logical
- [ ] Error messages are announced to screen readers
- [ ] Loading states use aria-busy
- [ ] Keyboard navigation works for all interactions

### Step 7: Register Route and Update Navigation

**Input:** Verified surface.
**Action:**
1. Add route to `apps/{app}/src/routes.js`.
2. Add navigation item to `apps/{app}/src/shell/{App}Nav.js` if the surface is a top-level page.
3. Verify the surface is accessible via navigation.

### Step 8: Produce Receipts

**Input:** All tests passing, observability and accessibility verified.
**Output:** The feature receipt consists of:

1. **Surface contract file** — the specification
2. **Playwright test results** — all passing
3. **Telemetry verification** — events emitted correctly
4. **Accessibility audit** — axe scan clean
5. **Files created/modified** — list of all files touched

Report these as the deliverable. The feature is complete when all receipts are verified.

---

## Workflow: Modifying an Existing Feature

1. Read the existing surface contract.
2. Update the surface contract with changes.
3. Update Playwright tests to cover new/changed behavior.
4. Run existing tests — they should fail for the changed behavior.
5. Implement the changes.
6. Run all tests — old and new must pass.
7. Verify observability and accessibility.
8. Produce receipts.

**Critical rule:** Never modify implementation without first updating the contract and tests.

---

## Workflow: Fixing a Bug

1. Read the surface contract for the affected surface.
2. Write a Playwright test that reproduces the bug (should fail).
3. Fix the bug in the implementation.
4. Verify the new test passes.
5. Verify all existing tests still pass.
6. Verify the fix doesn't break observability or accessibility.

**Critical rule:** Every bug fix MUST include a regression test.

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | What to Do Instead |
|---------|---------------|-------------------|
| Implementing before writing the contract | Test IDs and telemetry events are invented ad-hoc | Always write the contract first |
| Using raw HTML instead of `@atlas/design` | Misses built-in a11y, test IDs, telemetry | Always use design primitives |
| Using `innerHTML` instead of `html` template | Bypasses auto-escaping, enables XSS | Always use `html` tagged template |
| Not extending `Component` | Misses lifecycle, surfaceId, testId, telemetry integration | Always extend `@atlas/core` Component |
| Using `fetch` instead of `@atlas/api-client` | Misses correlationId, timing telemetry, error normalization | Always use the API client |
| Skipping the empty state | Blank screens when data doesn't exist | Always implement empty state with signals |
| Adding `data-testid` without contract | Test IDs drift from the spec | Always derive from contract |
| Skipping telemetry tests | No proof that observability works | Always test telemetry emission |
| Using `aria-label` when visible text exists | Screen readers announce the label, not the text | Use visible text as the accessible name |
| Forgetting correlationId on API calls | Frontend and backend traces are disconnected | Always generate before the call |
| Importing a third-party framework | Breaks ownership of the rendering pipeline | Use `@atlas/core` exclusively |
| Polling with `setInterval` | Wastes resources, stale data between intervals | Use `channel()` for server-pushed updates |
| Doing heavy computation in `render()` | Blocks the main thread, UI freezes | Use `computed()` signals or `offload()` for Web Worker |
| Using `alert()`/`confirm()` | Blocks the main thread | Use `<atlas-dialog>` and `<atlas-toast>` |
