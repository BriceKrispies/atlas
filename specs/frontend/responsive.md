# Responsive & Mobile-First

Atlas's four frontends render on phones, tablets, and laptops. The design system is authored **mobile-first**: base styles work on a 360×640 phone and enhance upward via `@media (min-width: ...)`. This document is the normative contract for that behaviour.

Companion rules live in [constitution.md](./constitution.md) (C16) and [accessibility.md](./accessibility.md).

## R1 — Breakpoint Tokens

**R1.1** Breakpoints are published as CSS custom properties on `:root` in `packages/design/src/tokens.css`:

| Token | Value | Scope |
|-------|-------|-------|
| `--atlas-bp-sm` | `640px`  | phone → small tablet |
| `--atlas-bp-md` | `900px`  | tablet → laptop |
| `--atlas-bp-lg` | `1200px` | desktop |

**R1.2** The same values are exported from `packages/design/src/breakpoints.js` as `BREAKPOINTS`. JS consumers (e.g. layout signals, debug helpers) MUST import from that module rather than hard-coding pixel values.

**R1.3** Authored media queries MUST use literal pixel values mirroring R1.1 (CSS custom properties are not valid in `@media` conditions). The value MUST equal the corresponding token.

**R1.4** A new breakpoint MUST NOT be introduced without updating `tokens.css` **and** `breakpoints.js` in the same change.

## R2 — Mobile-First Cascade

**R2.1** Base styles target phones (≤640px viewport). All enhancements above that width MUST use `@media (min-width: ...)`. `@media (max-width: ...)` MUST NOT be used to retrofit a desktop-first default.

**R2.2** Consumers that need responsive direction MAY use `atlas-stack[orientation="stack-on-mobile"]` (column <640px, row ≥640px), `atlas-stack[orientation="always-row"]`, or `atlas-stack[orientation="always-column"]` instead of writing their own media queries.

## R3 — Touch Targets (WCAG 2.5.5)

**R3.1** Every interactive atlas element MUST render with a minimum bounding box of 44×44 CSS pixels. The minimum is encoded in `--atlas-touch-target-min` (default `44px`) and applied as `min-height` (plus `min-width` where applicable) in each element's styles.

**R3.2** The `[size="sm"]` variant on `atlas-button`, `atlas-tab-bar`, etc. MAY reduce visual padding but MUST NOT reduce the touch target below 44×44 on a coarse-pointer device (`@media (hover: none)`).

**R3.3** Editor chrome (drag handles, delete buttons, palette chips, dialog close buttons) MUST meet R3.1.

## R4 — Fluid Typography & Spacing

**R4.1** Typography and spacing tokens in `tokens.css` MUST use `clamp()` so their computed value scales continuously between a mobile floor and a desktop ceiling. Fixed pixel or rem values MUST NOT be used for text sizing in design-system tokens.

**R4.2** The root font-size MUST itself be fluid so every rem-based token scales without per-token media queries.

**R4.3** Consumer CSS SHOULD prefer tokens (`var(--atlas-space-md)`, `var(--atlas-font-size-md)`) over literal px values. Literal values in consumer CSS are acceptable for one-off geometry (e.g. a 220px sidebar width) but not for text or whitespace.

## R5 — Reflow (WCAG 1.4.10)

**R5.1** Layouts MUST reflow at 320px viewport width without introducing a horizontal document scrollbar. A Playwright test (`apps/sandbox/tests/mobile-viewport.test.js`) asserts this across every specimen.

**R5.2** Horizontal overflow within a single component (e.g. a wide data table or a tab strip) is permitted provided it is bounded by the component's own scroll container and the wider document does not scroll.

## R6 — Pointer & Hover Adaptation

**R6.1** Hover-only affordances (colour changes, underline-on-hover, ghost fills) MUST degrade gracefully on `@media (hover: none)` devices so they do not "stick" after a tap. Tokens.css neutralises hover transitions globally; individual elements MAY re-assert a coarse-pointer-friendly pressed state via `:active` or `:focus-visible`.

**R6.2** Elements that provide a drag surface on pointer devices MUST set `touch-action: none` so browser gesture defaults do not hijack the drag.

## R7 — Reduced Motion

**R7.1** `@media (prefers-reduced-motion: reduce)` MUST neutralise the `--atlas-transition-*` tokens to `0ms` and cap animation duration. Components that require motion for comprehension (e.g. progress indicators) MAY re-enable their own animation under an explicit rule, with the rationale commented in source.

## R8 — Viewport Meta

**R8.1** Every frontend app HTML entrypoint MUST include `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. `user-scalable=no` MUST NOT be set (it violates WCAG 1.4.4, resize text).

## R9 — Enforcement

**R9.1** A CI Playwright suite (`apps/sandbox/tests/mobile-viewport.test.js`) runs at 360×640 and asserts: no horizontal document scroll on any sandbox specimen, every interactive atlas element bounding box ≥44×44, admin-shell hamburger visible, drawer opens on toggle.

**R9.2** axe-core scans (see [testing-strategy.md](./testing-strategy.md)) continue to enforce the colour-contrast and focus-visibility requirements from WCAG 2.1 AA across both mobile and desktop viewport matrices.
