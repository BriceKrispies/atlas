import { AtlasElement } from '@atlas/core';

/**
 * <atlas-row> — table row. Replaces <tr>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   key — parameterized identifier, appended to data-testid
 */
class AtlasRow extends AtlasElement {
  protected override _applyTestId(): void {
    const name = this.getAttribute('name');
    const key = this.getAttribute('key');
    const sid = this.surfaceId;
    if (sid && name && key) {
      this.setAttribute('data-testid', `${sid}.${name}.${key}`);
    } else if (sid && name) {
      this.setAttribute('data-testid', `${sid}.${name}`);
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'row');
  }
}

AtlasElement.define('atlas-row', AtlasRow);
