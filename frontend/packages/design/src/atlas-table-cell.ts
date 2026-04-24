import { AtlasElement } from '@atlas/core';

/**
 * <atlas-table-cell> — table cell. Replaces <td> and <th>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   header — boolean, renders as column header
 */
class AtlasTableCell extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    const isHeader = this.hasAttribute('header');
    this.setAttribute('role', isHeader ? 'columnheader' : 'cell');
  }
}

AtlasElement.define('atlas-table-cell', AtlasTableCell);
