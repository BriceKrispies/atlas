import { AtlasElement } from '@atlas/core';

const styles = `
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
`;

class AtlasBadge extends AtlasElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${styles}</style><slot></slot>`;
  }
}

AtlasElement.define('atlas-badge', AtlasBadge);
