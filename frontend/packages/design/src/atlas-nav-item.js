import { AtlasElement } from '@atlas/core';

/**
 * <atlas-nav-item> — navigation item.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   active — boolean, marks as current page
 *   href   — hash route target (e.g., "#/content")
 */
class AtlasNavItem extends AtlasElement {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'link');
    this.setAttribute('tabindex', '0');
    if (this.hasAttribute('active')) {
      this.setAttribute('aria-current', 'page');
    }

    this.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.click();
      }
    });
  }
}

AtlasElement.define('atlas-nav-item', AtlasNavItem);
