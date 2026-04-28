import { AtlasElement } from '@atlas/core';

/**
 * <atlas-card> — bordered surface container. Replaces raw
 * `<div style="border:…;padding:…;border-radius:…">` patterns in
 * composed surfaces.
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   variant    — outlined (default) | elevated | filled
 *   padding    — xs | sm | md (default) | lg | xl
 *   interactive — (boolean) hover/focus affordance for clickable cards
 *   selected   — (boolean) primary-colored ring for selected state
 */
export class AtlasCard extends AtlasElement {}

AtlasElement.define('atlas-card', AtlasCard);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-card': AtlasCard;
  }
}
