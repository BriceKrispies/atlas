# `@atlas/design` — Atlas Design System

The home of every custom Atlas web component. **If a new component is needed,
add it here.** Other packages should not define new custom elements; they
compose these.

## Layout

Flat. One file per component, under `src/atlas-*.ts` (~90 components today).
No folder-per-component, no barrel grouping. The file name = the tag name = the
class name.

```
src/
  atlas-button.ts            <atlas-button>     class AtlasButton
  atlas-dialog.ts            <atlas-dialog>     class AtlasDialog
  atlas-table.ts             <atlas-table>      class AtlasTable
  ...                                            (~90 files)
  tokens.css                 design tokens (colors, spacing, type, shadows)
  elements.css               global Light-DOM element baseline
  shared-styles.ts           adoptAtlasStyles(shadowRoot) helper
  util.ts                    uid, escape*, createSheet, adoptSheet
  breakpoints.ts             matchesBreakpoint() + media-query constants
  icons.ts                   shared SVG icon set
```

## What Lives Here Already

A non-exhaustive grouping of the existing surface — the actual list is in `src/`:

| Category | Examples |
|----------|----------|
| Form controls | `atlas-button`, `atlas-input`, `atlas-textarea`, `atlas-checkbox`, `atlas-radio`, `atlas-switch`, `atlas-select`, `atlas-multi-select`, `atlas-slider`, `atlas-date-picker`, `atlas-file-upload`, `atlas-search-input` |
| Layout | `atlas-box`, `atlas-stack`, `atlas-grid`, `atlas-scroll-area` |
| Text | `atlas-text`, `atlas-heading`, `atlas-label` |
| Table | `atlas-table`, `atlas-table-head`, `atlas-table-body`, `atlas-table-cell`, `atlas-row` |
| Navigation | `atlas-nav`, `atlas-nav-item`, `atlas-breadcrumbs`, `atlas-pagination`, `atlas-stepper`, `atlas-step` |
| Overlays | `atlas-dialog`, `atlas-drawer`, `atlas-tooltip`, `atlas-toast`, `atlas-popover`, `atlas-bottom-sheet`, `atlas-action-sheet` |
| Menus | `atlas-menu`, `atlas-menu-item`, `atlas-menu-separator`, `atlas-command-palette` |
| Display | `atlas-card`, `atlas-badge`, `atlas-chip`, `atlas-avatar`, `atlas-activity`, `atlas-diff`, `atlas-json-view`, `atlas-code`, `atlas-color-picker` |

## Component Skeleton

A typical Shadow-DOM component (modeled on `atlas-button.ts`):

```ts
import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

const sheet = createSheet(`
  :host { display: inline-block; }
  button {
    /* ...tokens via var(--atlas-*) ... */
  }
  :host([variant="primary"]) button { /* ... */ }
`);

/**
 * <atlas-foo> — one-line description.
 *
 * Attributes:
 *   variant — "primary" | "danger" | "ghost"
 *   disabled
 *
 * Events: native `click` bubbles. On click, when surfaceId + name are present,
 * also emits telemetry via this.emit(...).
 */
export class AtlasFoo extends AtlasElement {
  declare variant: string;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'variant',
      AtlasElement.strAttr('variant', ''));
    Object.defineProperty(this.prototype, 'disabled',
      AtlasElement.boolAttr('disabled'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['disabled'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    root.innerHTML = `<button><slot></slot></button>`;
  }
}

AtlasElement.define('atlas-foo', AtlasFoo);
```

### Variant: Light-DOM components

Layout, table, and nav primitives skip the shadow root and rely on global
`elements.css`. Use this when child slotting via the Light DOM is essential
(tables, ARIA grouping). Keep these components style-light — let
`elements.css` carry the baseline.

### When the component IS a surface

Components that extend `AtlasSurface` (typically full pages, not primitives
that live here) follow the **body-slot pattern** for state rendering — see
[`packages/core/CLAUDE.md`](../core/CLAUDE.md#state-rendering--body-slot-pattern).
Most components here are sub-surface primitives so this doesn't apply, but
the pattern matters when `@atlas/widgets` or an app composes a surface from
design primitives.

## Design Tokens

Every visual property goes through `var(--atlas-*)` defined in `tokens.css`:
colors, spacing, radii, shadows, transitions, font sizes, line heights, touch
targets, breakpoint sizes. **Never hard-code colors or pixel values inside a
component.** If a token is missing, add it to `tokens.css` first.

## Conventions

- **Tag === file === class.** `atlas-foo` ↔ `src/atlas-foo.ts` ↔ `class AtlasFoo`. No exceptions.
- **Extend `AtlasElement`.** Every component, even a leaf one. You get test IDs, signals, lifecycle, telemetry.
- **`AtlasElement.define(...)` at module bottom.** Idempotent; safe to import twice.
- **Adopt stylesheets.** Use `createSheet(...)` once at module load, `adoptSheet(root, sheet)` in the constructor. This is faster and more cacheable than inline `<style>`.
- **Reflect via `strAttr` / `boolAttr`.** Don't write hand-rolled getters and setters.
- **Touch-target floor.** Interactive elements get `min-height: var(--atlas-touch-target-min, 44px)` (WCAG 2.5.5). Padding adjusts visual size; min-height stays.
- **Hover gating.** Wrap hover styles in `@media (hover: hover)` or counter them with `@media (hover: none)` to avoid sticky hovers on touch.
- **Telemetry.** Click handlers should call `this.emit('${surfaceId}.${name}-clicked', { ... })` when `name` and `surfaceId` are present.

## Adding a New Component

1. Pick a tag name: `atlas-<noun>`. Search `src/` first — odds are something close exists.
2. Create `src/atlas-<noun>.ts` from the skeleton above.
3. Use existing tokens. Add new tokens to `tokens.css` if needed.
4. `AtlasElement.define('atlas-<noun>', AtlasFoo)` at the bottom.
5. Re-export from `src/index.ts` if there is one (check the file).
6. Add a specimen under `apps/sandbox/src/specimens/` so it's visible in the gallery.
7. If it composes data, document the data shape in the JSDoc above the class.

## Don'ts

- **Don't reinvent design tokens.** Use the CSS variables.
- **Don't bypass `AtlasElement`.** Even for "just a wrapper" — you lose test IDs.
- **Don't import `@atlas/widgets` or `@atlas/page-templates`.** Dependency goes one way.
- **Don't add domain logic.** Components are presentation; pages and widgets coordinate data.
