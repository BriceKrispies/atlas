import { AtlasElement } from '@atlas/core';

/**
 * <atlas-spinner> — spinning loading indicator. Inherits colour from
 * `currentColor` so it matches the surrounding text.
 *
 * Light DOM. Styled via elements.css; the SVG is rendered as inline
 * light-DOM so consumers can size it via font-size, width, or the
 * `size` attribute.
 *
 * Attributes:
 *   size  — sm (16px) | md (default, 24px) | lg (36px) | 1em (inherit
 *           font size)
 *   label — accessible name. When set the host becomes role=status
 *           with aria-label. Otherwise aria-hidden (decorative).
 */
export class AtlasSpinner extends AtlasElement {
  private _built = false;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) {
      this.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" opacity="0.2"/>
          <path d="M21 12a9 9 0 0 0-9-9"/>
        </svg>
      `;
      this._built = true;
    }
    const label = this.getAttribute('label');
    if (label) {
      this.setAttribute('role', 'status');
      this.setAttribute('aria-label', label);
      this.removeAttribute('aria-hidden');
    } else {
      this.setAttribute('aria-hidden', 'true');
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
    }
  }
}

AtlasElement.define('atlas-spinner', AtlasSpinner);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-spinner': AtlasSpinner;
  }
}
