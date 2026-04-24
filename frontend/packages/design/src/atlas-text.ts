import { AtlasElement } from '@atlas/core';

/**
 * <atlas-text> — text content. Replaces <p>, <span>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   variant — body (default), muted, medium, error, small, mono
 *   block — if present, renders as block
 */
class AtlasText extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
  }
}

AtlasElement.define('atlas-text', AtlasText);
