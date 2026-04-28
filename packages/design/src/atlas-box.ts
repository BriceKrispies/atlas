import { AtlasElement } from '@atlas/core';

/**
 * <atlas-box> — layout container. Replaces <div>.
 * Light DOM pass-through. Styled via elements.css.
 *
 * Attributes:
 *   padding    — xs | sm | md | lg | xl | 2xl
 *   margin     — xs | sm | md | lg | xl | 2xl
 *   background — bg | surface | surface-hover | primary-subtle | shell
 *                (shell also inverts text color for dark chrome)
 *   border     — (boolean) 1px solid border on all sides, OR
 *                top | bottom | left | right | x | y for directional variants
 *   rounded    — none | sm | md | lg   (omission = no radius)
 *   elevation  — none | sm | md | lg   (omission = no shadow)
 *   grow       — (boolean) flex: 1 1 auto; useful inside atlas-stack
 *   scroll     — x | y | both | none   (auto overflow + iOS momentum scroll)
 *
 * All attributes are additive — authors combine them declaratively rather
 * than falling back to `data-role=".."` + CSS.
 */
export class AtlasBox extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
  }
}

AtlasElement.define('atlas-box', AtlasBox);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-box': AtlasBox;
  }
}
