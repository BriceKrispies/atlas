import { AtlasElement } from '@atlas/core';

/**
 * <atlas-scroll-area> — constrained scroll container with consistent
 * styling across platforms. Replaces raw
 * `<div style="overflow:auto; -webkit-overflow-scrolling:touch">`.
 *
 * Light DOM. Styled via elements.css.
 *
 * Differs from `<atlas-box scroll="y">` in that a scroll-area is a
 * distinct semantic region — it carries `role="region"` when labelled,
 * and its scrollbar gets design-system tokenised colours.
 *
 * Attributes:
 *   direction — y (default) | x | both
 *   rail      — visible (default) | auto | hidden — scrollbar
 *               visibility hint. `auto` collapses on idle (platform
 *               default); `hidden` removes chrome entirely.
 *   label     — accessible name. When set, the host gets
 *               role=region + aria-label.
 */
export class AtlasScrollArea extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    const label = this.getAttribute('label');
    if (label) {
      this.setAttribute('role', 'region');
      this.setAttribute('aria-label', label);
    }
  }
}

AtlasElement.define('atlas-scroll-area', AtlasScrollArea);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-scroll-area': AtlasScrollArea;
  }
}
