/**
 * Shared element stylesheet for use inside Shadow DOM.
 *
 * Light DOM atlas elements are styled by elements.css in the document scope.
 * When atlas elements appear inside a Shadow DOM boundary, those rules
 * can't reach them. This module provides the same styles as a CSSStyleSheet
 * that Shadow DOM hosts can adopt.
 *
 * Usage:
 *   import { adoptAtlasStyles } from '@atlas/design/shared-styles';
 *   // in constructor, after attachShadow:
 *   adoptAtlasStyles(this.shadowRoot);
 */

import cssText from './elements.css?inline';

const sheet = new CSSStyleSheet();
sheet.replaceSync(cssText);

/**
 * Adopt atlas element styles into a shadow root.
 * Merges with any existing adopted stylesheets.
 */
export function adoptAtlasStyles(shadowRoot: ShadowRoot): void {
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
}
