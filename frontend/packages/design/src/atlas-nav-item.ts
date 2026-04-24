import { AtlasElement } from '@atlas/core';

/**
 * <atlas-nav-item> — navigation item.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   active   — (boolean) marks as current page (aria-current="page")
 *   disabled — (boolean) greys out + disables pointer/keyboard interaction
 *   href     — hash route target (e.g., "#/content")
 */
export class AtlasNavItem extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['disabled'];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'link');
    this._syncDisabled();
    if (this.hasAttribute('active')) {
      this.setAttribute('aria-current', 'page');
    }

    this.addEventListener('keydown', (e) => {
      if (this.hasAttribute('disabled')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.click();
      }
    });
  }

  override attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    if (name === 'disabled') this._syncDisabled();
  }

  private _syncDisabled(): void {
    if (this.hasAttribute('disabled')) {
      // Remove from keyboard tab order + mark for AT consumers. Pointer
      // events are blocked via CSS (pointer-events: none) in elements.css.
      this.setAttribute('aria-disabled', 'true');
      this.setAttribute('tabindex', '-1');
    } else {
      this.removeAttribute('aria-disabled');
      this.setAttribute('tabindex', '0');
    }
  }
}

AtlasElement.define('atlas-nav-item', AtlasNavItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-nav-item': AtlasNavItem;
  }
}
