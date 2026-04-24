/**
 * Shared widget stylesheet for use inside Shadow DOM.
 *
 * Widget elements (atlas-chart, atlas-sparkline, atlas-kpi-tile,
 * atlas-data-table, ...) are styled by styles.css in the document scope.
 * When they appear inside a Shadow DOM boundary, those rules can't reach
 * them. This module provides the same styles as a CSSStyleSheet that
 * Shadow DOM hosts can adopt.
 *
 * Usage:
 *   import { adoptAtlasWidgetStyles } from '@atlas/widgets/shared-styles';
 *   // after attachShadow:
 *   adoptAtlasWidgetStyles(this.shadowRoot);
 */
import cssText from './styles.css?inline';

const sheet = new CSSStyleSheet();
sheet.replaceSync(cssText);

/**
 * Adopt widget element styles into a shadow root.
 * Merges with any existing adopted stylesheets.
 */
export function adoptAtlasWidgetStyles(shadowRoot: ShadowRoot): void {
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
}
