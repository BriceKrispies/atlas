import { AtlasElement } from '@atlas/core';

/**
 * <atlas-timeline> — vertical, ordered log of events.
 *
 * Composition: expects one or more `<atlas-timeline-item>` children.
 * The timeline is a thin container that sets `role="list"` and lets
 * its items lay out themselves; each item carries its own timestamp,
 * variant, dot, and rail segment.
 *
 * Light DOM — like atlas-card / atlas-stack / atlas-nav. A previous
 * iteration used a shadow root with a `::slotted(atlas-timeline-item)
 * { display: block }` rule, which under the CSS Scoping cascade
 * (outer encapsulation context wins over inner for normal decls)
 * overrode the items' own `:host { display: grid }`, collapsing each
 * item to a stacked block and pushing the rail through the body text.
 *
 * Attributes: none currently. Future: `compact`, `reverse-chronology`.
 *
 * a11y: role="list" on parent, role="listitem" on each child.
 */

export class AtlasTimeline extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'list');
  }
}

AtlasElement.define('atlas-timeline', AtlasTimeline);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-timeline': AtlasTimeline;
  }
}
