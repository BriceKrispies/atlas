import { AtlasElement } from '@atlas/core';

/**
 * <atlas-code> — monospace token / inline code / code block.
 * Replaces raw `<code>` + ad-hoc `font-family: mono` CSS.
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   block — (boolean) renders as a block with scroll + padding.
 *   tone  — default (muted surface) | strong | none
 */
export class AtlasCode extends AtlasElement {}

AtlasElement.define('atlas-code', AtlasCode);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-code': AtlasCode;
  }
}
