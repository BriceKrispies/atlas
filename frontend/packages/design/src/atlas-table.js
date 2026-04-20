import { AtlasElement } from '@atlas/core';

/**
 * <atlas-table> — table container. Replaces <table>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   label — accessible name for the table
 */
class AtlasTable extends AtlasElement {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'table');
    const label = this.getAttribute('label');
    if (label) {
      this.setAttribute('aria-label', label);
    }
  }
}

AtlasElement.define('atlas-table', AtlasTable);
