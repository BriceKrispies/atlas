import { AtlasElement } from '@atlas/core';

/**
 * <atlas-label> — short caption / eyebrow above a section header or
 * a variant block. Uppercase, letter-spaced, muted by default.
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   tone — default (muted) | strong | primary
 *   size — sm (default) | xs
 *   for  — optional id of a form control, for semantic labelling.
 */
export class AtlasLabel extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    const forId = this.getAttribute('for');
    if (forId && !this.hasAttribute('role')) {
      // Light-DOM element; we can't become a real <label>, but we can
      // set aria-hidden + a programmatic pointer so AT reads the
      // control's own label instead of duplicating.
      this.setAttribute('data-for', forId);
    }
  }
}

AtlasElement.define('atlas-label', AtlasLabel);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-label': AtlasLabel;
  }
}
