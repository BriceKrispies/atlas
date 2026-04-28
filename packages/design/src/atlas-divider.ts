import { AtlasElement } from '@atlas/core';

/**
 * <atlas-divider> — horizontal or vertical rule. Replaces raw
 * `<hr>` or `<div style="border-top:…">`.
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   orientation — horizontal (default) | vertical
 *   tone        — default | strong | subtle
 *   spacing     — none (default) | sm | md | lg — vertical margin in
 *                 flow. Ignored for vertical dividers.
 */
export class AtlasDivider extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'separator');
    const o = this.getAttribute('orientation');
    if (o === 'vertical' && !this.hasAttribute('aria-orientation')) {
      this.setAttribute('aria-orientation', 'vertical');
    }
  }
}

AtlasElement.define('atlas-divider', AtlasDivider);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-divider': AtlasDivider;
  }
}
