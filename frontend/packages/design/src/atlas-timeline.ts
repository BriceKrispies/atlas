import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-timeline> — vertical, ordered log of events.
 *
 * Composition: expects one or more `<atlas-timeline-item>` children.
 * The timeline is the policy holder for layout (rail line + dot grid)
 * and a11y semantics (`role="list"`); each item carries its own
 * timestamp, variant, and slots.
 *
 * Light DOM. The vertical rail is rendered via a positioned pseudo
 * element on the host so the line cannot break across long content
 * (rule from brief: no background-image rail).
 *
 * Attributes: none currently. Future: `compact`, `reverse-chronology`.
 *
 * a11y:
 *   role="list" on parent, role="listitem" on each child.
 */

const sheet = createSheet(`
  :host {
    display: block;
    position: relative;
    padding: 0;
    margin: 0;
  }
  ::slotted(atlas-timeline-item) {
    display: block;
  }
`);

export class AtlasTimeline extends AtlasElement {
  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'list');
    if (!this._built) {
      const slot = document.createElement('slot');
      this.shadowRoot?.appendChild(slot);
      this._built = true;
    }
  }
}

AtlasElement.define('atlas-timeline', AtlasTimeline);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-timeline': AtlasTimeline;
  }
}
