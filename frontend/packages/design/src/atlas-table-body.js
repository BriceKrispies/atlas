import { AtlasElement } from '@atlas/core';

/**
 * <atlas-table-body> — table body group. Replaces <tbody>.
 * Light DOM. Styled via elements.css.
 */
class AtlasTableBody extends AtlasElement {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'rowgroup');
  }
}

AtlasElement.define('atlas-table-body', AtlasTableBody);
