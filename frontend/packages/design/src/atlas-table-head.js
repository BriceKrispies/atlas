import { AtlasElement } from '@atlas/core';

/**
 * <atlas-table-head> — table header group. Replaces <thead>.
 * Light DOM. Styled via elements.css.
 */
class AtlasTableHead extends AtlasElement {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'rowgroup');
  }
}

AtlasElement.define('atlas-table-head', AtlasTableHead);
