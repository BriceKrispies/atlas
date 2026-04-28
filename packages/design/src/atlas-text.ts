import { AtlasElement } from '@atlas/core';

/**
 * <atlas-text> — text content. Replaces <p>, <span>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   variant  — body (default) | muted | medium | error | small | mono
 *   block    — (boolean) renders as block instead of inline
 *   truncate — (boolean) single-line ellipsis; also switches display to block
 *              so overflow rules apply. Useful inside table cells on mobile.
 */
export class AtlasText extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
  }
}

AtlasElement.define('atlas-text', AtlasText);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-text': AtlasText;
  }
}
