import { AtlasElement } from '@atlas/core';

/**
 * <atlas-stack> — flex layout container. Replaces <div> with flex.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   direction   — row | column (default)
 *   gap         — none | xs | sm | md (default) | lg | xl
 *   align       — start | center | end | stretch | baseline
 *   justify     — start | center | end | space-between | space-around
 *   wrap        — (boolean) enables flex-wrap
 *   orientation — stack-on-mobile | always-row | always-column
 *   padding     — xs | sm | md | lg | xl | 2xl
 *   margin      — xs | sm | md | lg | xl | 2xl
 *   grow        — (boolean) flex: 1 1 auto
 *   separator   — (boolean | "solid" | "dotted") adds a 1px divider between
 *                 direct children via `> * + *`. Direction-aware: top border
 *                 in a column stack, left border in a row stack.
 */
export class AtlasStack extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
  }
}

AtlasElement.define('atlas-stack', AtlasStack);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-stack': AtlasStack;
  }
}
