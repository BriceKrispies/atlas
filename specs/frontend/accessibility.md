# Accessibility

## Accessibility Is a Platform Requirement

Accessibility is not polish, not a nice-to-have, not a phase-2 concern. It is a platform requirement on the same level as authentication and tenant isolation.

Reasons:
1. **Enterprise customers require it.** Many Atlas target customers (healthcare, finance, government) have legal obligations under ADA, Section 508, EN 301 549, or WCAG compliance policies.
2. **It makes automation work.** Semantic HTML and ARIA attributes are what Playwright's semantic locators rely on. Accessible UI is testable UI.
3. **It prevents rework.** Retrofitting accessibility is 5-10x more expensive than building it in. Every component in `@atlas/design` bakes accessibility in from the start.

## Minimum Accessibility Bar

Every new surface MUST meet WCAG 2.1 Level AA. This is not aspirational — it is enforced by:
- axe-core scan in every Playwright test (see [testing-strategy.md](./testing-strategy.md))
- `@atlas/design` primitives that enforce correct patterns
- Surface contract review that requires `a11y` specification

## Required Baseline Semantics

### Forms

- Every `<input>`, `<select>`, and `<textarea>` MUST have a visible `<label>` associated via `for`/`id`.
- Form groups MUST use `<fieldset>` and `<legend>` when multiple controls share a label (e.g., radio groups, address fields).
- Required fields MUST be indicated via `aria-required="true"` AND a visible indicator (not just color).
- Validation errors MUST be associated with their field via `aria-describedby`.
- Form submission MUST use `<form>` with `onSubmit`, not click handlers on arbitrary elements.
- Submit buttons MUST use `<button type="submit">`, not `<div>` or `<span>` with click handlers.

```html
<!-- Correct -->
<form onSubmit={handleSubmit}>
  <label for="page-title">Page title</label>
  <input
    id="page-title"
    aria-required="true"
    aria-describedby="page-title-error"
  />
  <span id="page-title-error" role="alert"></span>
  <button type="submit">Save</button>
</form>
```

### Buttons

- Every button MUST have an accessible name: visible text, `aria-label`, or `aria-labelledby`.
- Icon-only buttons MUST have `aria-label` describing the action, not the icon.
- Toggle buttons MUST use `aria-pressed` to indicate state.
- Buttons that open menus MUST use `aria-haspopup` and `aria-expanded`.

```html
<!-- Correct: icon button with accessible name -->
<button aria-label="Delete page" data-testid="admin.content.pages-list.row-delete.pg_01">
  <TrashIcon aria-hidden="true" />
</button>

<!-- Correct: toggle button -->
<button aria-pressed={isActive} aria-label="Toggle notifications">
  <BellIcon aria-hidden="true" />
</button>
```

### Dialogs

- Modal dialogs MUST use `<dialog>` or `role="dialog"` with `aria-modal="true"`.
- Dialogs MUST have an accessible name via `aria-labelledby` pointing to the dialog title.
- Focus MUST move to the dialog when it opens (first focusable element or the dialog itself).
- Focus MUST be trapped within the dialog while open.
- Focus MUST return to the trigger element when the dialog closes.
- Escape key MUST close the dialog.
- Destructive confirmation dialogs MUST default focus to the cancel button, not the destructive action.

```html
<dialog
  aria-labelledby="delete-dialog-title"
  aria-modal="true"
  aria-describedby="delete-dialog-desc"
>
  <h2 id="delete-dialog-title">Delete page</h2>
  <p id="delete-dialog-desc">This action cannot be undone.</p>
  <button autofocus>Cancel</button>  <!-- Default focus on safe option -->
  <button>Delete</button>
</dialog>
```

### Tables

- Data tables MUST use `<atlas-table>` with `<atlas-table-head>`, `<atlas-table-body>`, `<atlas-row>`, and `<atlas-table-cell>`.
- Column headers MUST use `<atlas-table-cell header>` which auto-sets `role="columnheader"`.
- `<atlas-table>` uses CSS `display: table` and ARIA `role="table"`. Child elements use `display: table-header-group`, `table-row-group`, `table-row`, and `table-cell` respectively.
- Sortable columns MUST indicate sort state via `aria-sort="ascending"`, `"descending"`, or `"none"` on the cell.
- Tables MUST have a `label` attribute (which sets `aria-label`) describing the table's content.
- Empty tables MUST show an explicit empty state, not a table with zero rows.

```html
<atlas-table name="table" label="Content pages">
  <atlas-table-head>
    <atlas-row>
      <atlas-table-cell header>Title</atlas-table-cell>
      <atlas-table-cell header>Status</atlas-table-cell>
      <atlas-table-cell header>Updated</atlas-table-cell>
      <atlas-table-cell header>Actions</atlas-table-cell>
    </atlas-row>
  </atlas-table-head>
  <atlas-table-body>
    <!-- atlas-row elements -->
  </atlas-table-body>
</atlas-table>
```

### Navigation

- Primary navigation MUST use `<atlas-nav label="Primary navigation">` (which auto-sets `role="navigation"` and `aria-label`).
- When multiple `<atlas-nav>` elements exist, each MUST have a unique `label` attribute.
- The current page MUST be indicated with `<atlas-nav-item active>` (which auto-sets `aria-current="page"`).
- Skip links MUST be the first focusable element on the page.
- Breadcrumbs MUST use `<atlas-nav label="Breadcrumb">`.

### Errors and Notifications

- Form validation errors MUST be associated with fields via `aria-describedby`.
- Summary errors (e.g., "3 errors on this form") MUST use `role="alert"` to announce immediately.
- Toast notifications MUST use `role="status"` (polite) for success, `role="alert"` (assertive) for errors.
- Error boundaries MUST render a meaningful message, not a blank screen.
- Loading completion MUST be announced via `aria-live="polite"` region.

### Loading States

- Loading regions MUST set `aria-busy="true"` on the container being loaded.
- When loading completes, the container MUST set `aria-busy="false"`.
- An `aria-live="polite"` region SHOULD announce "Content loaded" or equivalent.
- Skeleton screens are preferred over spinners (less disorienting, better layout stability).

### Images and Icons

- Decorative images/icons MUST use `aria-hidden="true"` and empty `alt=""`.
- Informational images MUST have descriptive `alt` text.
- Icon-only interactive elements MUST have `aria-label` on the interactive element, not the icon.
- SVG icons MUST use `aria-hidden="true"` when used inside labeled elements.

## How Accessibility Supports Automation

Semantic HTML is not just for screen readers — it is the foundation of stable test selectors.

| Semantic Pattern | Playwright Locator | Benefit |
|-----------------|-------------------|---------|
| `<button>Create page</button>` | `getByRole('button', { name: 'Create page' })` | Tests verify the button is accessible |
| `<label for="title">Title</label><input id="title">` | `getByLabel('Title')` | Tests verify the label association |
| `<table aria-label="Pages">` | `getByRole('table', { name: 'Pages' })` | Tests verify table semantics |
| `<nav aria-label="Primary">` | `getByRole('navigation', { name: 'Primary' })` | Tests verify landmark structure |
| `<h1>Content Pages</h1>` | `getByRole('heading', { name: 'Content Pages' })` | Tests verify heading hierarchy |

When a Playwright test using semantic locators passes, it simultaneously proves:
1. The feature works correctly.
2. The feature is accessible.

This is why accessibility-first and Playwright-first are complementary, not competing.

## `@atlas/design` Accessibility Guarantees

The shared design system components MUST enforce these patterns automatically:

| Component | Built-In Accessibility |
|-----------|----------------------|
| `<atlas-button>` | Requires text content or `aria-label`. Auto-generates `data-testid` from `name` attr. Auto-emits click telemetry. |
| `<atlas-input>` | Requires `label` attribute (renders visible `<label>`). Shadow DOM encapsulation. Links `aria-describedby` for errors. |
| `<atlas-table>` | CSS `display: table` + `role="table"`. Requires `label` attr. Children (`<atlas-table-head>`, `<atlas-row>`, `<atlas-table-cell>`) auto-set their ARIA roles. |
| `<atlas-table-cell header>` | Auto-sets `role="columnheader"`, bold styling, uppercase. Without `header`, sets `role="cell"`. |
| `<atlas-heading>` | Auto-sets `role="heading"` + `aria-level` from `level` attribute. |
| `<atlas-nav>` | Auto-sets `role="navigation"` + `aria-label` from `label` attribute. |
| `<atlas-nav-item active>` | Auto-sets `aria-current="page"` when `active` attribute present. |
| `<atlas-skeleton>` | Sets `aria-busy="true"`. Announces completion. |
| `<atlas-badge>` | Status indicator with semantic color + text. |
| `<atlas-box>` | Pass-through container. Sets `display: block`. |
| `<atlas-text>` | Semantic text with variant styling (`muted`, `error`, `medium`, `small`). |
| `<atlas-stack>` | Flexbox layout. No semantic overhead. |

Feature developers using `@atlas/design` elements (built on `@atlas/core` `AtlasElement`) get accessibility compliance for free. This is intentional — the elements are designed so that the path of least resistance is the accessible path.

## Minimum Accessibility Verification

Every surface MUST include in its Playwright tests:

```javascript
test('passes axe accessibility audit', async ({ page }) => {
  // Navigate to surface in success state
  await page.goto('/admin/content/pages');
  await expect(page.getByTestId('admin.content.pages-list.state-success')).toBeVisible();

  // Run axe scan
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  expect(results.violations).toEqual([]);
});
```

This test MUST be run against at least the success state. SHOULD be run against error and empty states as well.
