import { AtlasElement } from '@atlas/core';

/**
 * <atlas-table> — table container. Replaces <table>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   label — accessible name for the table
 */
export class AtlasTable extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'table');
    const label = this.getAttribute('label');
    if (label) {
      this.setAttribute('aria-label', label);
    }
  }
}

AtlasElement.define('atlas-table', AtlasTable);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-table': AtlasTable;
  }
}
