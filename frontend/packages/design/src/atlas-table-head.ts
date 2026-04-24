import { AtlasElement } from '@atlas/core';

/**
 * <atlas-table-head> — table header group. Replaces <thead>.
 * Light DOM. Styled via elements.css.
 */
export class AtlasTableHead extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'rowgroup');
  }
}

AtlasElement.define('atlas-table-head', AtlasTableHead);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-table-head': AtlasTableHead;
  }
}
