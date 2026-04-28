import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

const sheet = createSheet(`
  :host {
    display: block;
    padding: var(--atlas-space-sm) 0;
  }
  .row {
    /* Rows track the current text size instead of a hardcoded 18px so the
       skeleton shape matches the eventual content height on both phone
       and desktop. */
    height: 1em;
    background: var(--atlas-color-surface);
    animation: pulse 1.8s ease-in-out infinite;
    border-radius: var(--atlas-radius-sm);
    margin-bottom: var(--atlas-space-sm);
    max-width: 40ch;
  }
  .row:nth-child(odd)  { width: 85%; }
  .row:nth-child(even) { width: 65%; }
  .row:last-child { margin-bottom: 0; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
`);

/**
 * <atlas-skeleton> — row-based loading shimmer. `rows` attribute controls how
 * many shimmer bars are rendered (default 5). Rebuilt only when `rows`
 * changes; otherwise the DOM is inert.
 */
export class AtlasSkeleton extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['rows'];
  }

  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-busy', 'true');
    this._buildRows();
    this._built = true;
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'rows') this._buildRows();
  }

  private _buildRows(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const count = Math.max(0, parseInt(this.getAttribute('rows') ?? '5', 10) || 0);
    root.textContent = '';
    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      root.appendChild(row);
    }
  }
}

AtlasElement.define('atlas-skeleton', AtlasSkeleton);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-skeleton': AtlasSkeleton;
  }
}
