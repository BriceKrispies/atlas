import { AtlasElement } from '@atlas/core';

/**
 * <atlas-nav> — navigation landmark. Replaces <nav>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   label — accessible name for the navigation region
 */
class AtlasNav extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'navigation');
    const label = this.getAttribute('label');
    if (label) {
      this.setAttribute('aria-label', label);
    }
  }
}

AtlasElement.define('atlas-nav', AtlasNav);
