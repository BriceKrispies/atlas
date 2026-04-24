import { AtlasElement } from '@atlas/core';

const styles = `
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
`;

class AtlasSkeleton extends AtlasElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-busy', 'true');

    const rows = parseInt(this.getAttribute('rows') ?? '5', 10);
    let inner = `<style>${styles}</style>`;
    for (let i = 0; i < rows; i++) {
      inner += '<div class="row"></div>';
    }
    if (this.shadowRoot) {
      this.shadowRoot.innerHTML = inner;
    }
  }
}

AtlasElement.define('atlas-skeleton', AtlasSkeleton);
