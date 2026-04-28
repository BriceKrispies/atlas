import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

const sheet = createSheet(`
  :host {
    display: inline-flex;
    align-items: center;
    padding: 1px var(--atlas-space-sm);
    border-radius: var(--atlas-radius-sm);
    font-size: var(--atlas-font-size-xs);
    font-weight: var(--atlas-font-weight-medium);
    font-family: var(--atlas-font-family);
    letter-spacing: 0.01em;
    line-height: 1.5;
    white-space: nowrap;
  }
  :host([status="published"]) {
    background: var(--atlas-color-success-subtle);
    color: var(--atlas-color-success-text);
  }
  :host([status="draft"]) {
    background: var(--atlas-color-warning-subtle);
    color: var(--atlas-color-warning-text);
  }
  :host([status="archived"]) {
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text-muted);
  }
`);

/**
 * <atlas-badge> — inline status pill. Consumers style via the `status`
 * attribute (`published` | `draft` | `archived`). The shadow tree is a single
 * `<slot>` so content remains in the light DOM.
 */
export class AtlasBadge extends AtlasElement {
  declare status: string;

  static {
    Object.defineProperty(
      this.prototype,
      'status',
      AtlasElement.strAttr('status', ''),
    );
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    root.appendChild(document.createElement('slot'));
  }
}

AtlasElement.define('atlas-badge', AtlasBadge);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-badge': AtlasBadge;
  }
}
