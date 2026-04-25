import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-menu-separator> — visual divider between groups of
 * <atlas-menu-item>s inside an <atlas-menu>. Pure presentation; carries
 * `role="separator"` for assistive tech.
 *
 * Shadow DOM. No attributes, no events.
 */
const sheet = createSheet(`
  :host {
    display: block;
    height: 1px;
    margin: 4px 6px;
    background: var(--atlas-color-border);
  }
  :host([hidden]) { display: none; }
`);

export class AtlasMenuSeparator extends AtlasElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'separator');
    this.setAttribute('aria-orientation', 'horizontal');
  }
}

AtlasElement.define('atlas-menu-separator', AtlasMenuSeparator);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-menu-separator': AtlasMenuSeparator;
  }
}
