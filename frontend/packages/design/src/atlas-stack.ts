import { AtlasElement } from '@atlas/core';

/**
 * <atlas-stack> — flex layout container. Replaces <div> with flex.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   direction — row, column (default)
 *   gap — none, xs, sm, md (default), lg, xl
 *   align — start, center, end, stretch, baseline
 *   justify — start, center, end, space-between, space-around
 *   wrap — if present, enables flex-wrap
 */
class AtlasStack extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
  }
}

AtlasElement.define('atlas-stack', AtlasStack);
