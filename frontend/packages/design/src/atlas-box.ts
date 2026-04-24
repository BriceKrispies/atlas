import { AtlasElement } from '@atlas/core';

/**
 * <atlas-box> — layout container. Replaces <div>.
 * Light DOM pass-through. Styled via elements.css.
 *
 * Attributes:
 *   padding — xs, sm, md, lg, xl, 2xl
 */
class AtlasBox extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
  }
}

AtlasElement.define('atlas-box', AtlasBox);
