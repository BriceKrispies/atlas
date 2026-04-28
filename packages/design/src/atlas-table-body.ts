import { AtlasElement } from '@atlas/core';

/**
 * <atlas-table-body> — table body group. Replaces <tbody>.
 * Light DOM. Styled via elements.css.
 */
export class AtlasTableBody extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'rowgroup');
  }
}

AtlasElement.define('atlas-table-body', AtlasTableBody);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-table-body': AtlasTableBody;
  }
}
