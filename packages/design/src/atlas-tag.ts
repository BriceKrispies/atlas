import { AtlasElement } from '@atlas/core';

/**
 * <atlas-tag> — read-only labelled pill (metadata). Light DOM.
 *
 * Distinct from <atlas-badge>:
 *   atlas-badge — semantic status carrier (published / draft / archived)
 *   atlas-tag   — neutral metadata label, variant-coloured, no behavioural
 *                 meaning beyond "this is a label".
 *
 * Attributes:
 *   variant — neutral (default) | info | success | warning | danger
 *   size    — sm (default) | md
 *
 * Slots: default — text content.
 */
export class AtlasTag extends AtlasElement {
  declare variant: string;
  declare size: string;

  static {
    Object.defineProperty(this.prototype, 'variant', AtlasElement.strAttr('variant', ''));
    Object.defineProperty(this.prototype, 'size',    AtlasElement.strAttr('size', ''));
  }
}

AtlasElement.define('atlas-tag', AtlasTag);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-tag': AtlasTag;
  }
}
