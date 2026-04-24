import { AtlasElement } from '@atlas/core';

/**
 * <atlas-kbd> — keyboard shortcut pill. Replaces `<kbd>` elements
 * and their one-off CSS.
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   size — sm (default) | xs
 */
export class AtlasKbd extends AtlasElement {}

AtlasElement.define('atlas-kbd', AtlasKbd);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-kbd': AtlasKbd;
  }
}
