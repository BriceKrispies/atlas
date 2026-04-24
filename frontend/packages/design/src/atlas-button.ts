import { AtlasElement } from '@atlas/core';

const styles = `
  :host {
    display: inline-block;
  }
  button {
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-md);
    font-weight: var(--atlas-font-weight-medium);
    line-height: var(--atlas-line-height);
    /* WCAG 2.5.5 touch target. min-height wins on narrow phones; padding
       handles visual breathing room on wider viewports. */
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    cursor: pointer;
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast),
                border-color var(--atlas-transition-fast);
  }
  button:hover {
    background: var(--atlas-color-surface);
    border-color: var(--atlas-color-border-strong);
  }
  button:active {
    background: var(--atlas-color-surface-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 1px;
  }
  :host([variant="primary"]) button {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
    border-color: var(--atlas-color-primary);
  }
  :host([variant="primary"]) button:hover {
    background: var(--atlas-color-primary-hover);
    border-color: var(--atlas-color-primary-hover);
  }
  :host([variant="danger"]) button {
    background: var(--atlas-color-bg);
    color: var(--atlas-color-danger);
    border-color: var(--atlas-color-border);
  }
  :host([variant="danger"]) button:hover {
    background: var(--atlas-color-danger-subtle);
    border-color: var(--atlas-color-danger);
  }
  :host([variant="ghost"]) button {
    background: transparent;
    border-color: transparent;
    color: var(--atlas-color-text-muted);
  }
  :host([variant="ghost"]) button:hover {
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text);
  }
  :host([size="sm"]) button {
    font-size: var(--atlas-font-size-sm);
    /* sm retains the full target minimum on touch; only padding shrinks. */
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
  }
  @media (hover: none) {
    button:hover {
      background: var(--atlas-color-bg);
      border-color: var(--atlas-color-border);
    }
    :host([variant="primary"]) button:hover {
      background: var(--atlas-color-primary);
      border-color: var(--atlas-color-primary);
    }
  }
`;

class AtlasButton extends AtlasElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${styles}</style><button><slot></slot></button>`;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    const btn = this.shadowRoot?.querySelector('button');
    btn?.addEventListener('click', () => {
      const name = this.getAttribute('name');
      if (this.surfaceId && name) {
        this.emit(`${this.surfaceId}.${name}-clicked`);
      }
    });
  }

  get label(): string {
    return this.textContent?.trim() ?? '';
  }
}

AtlasElement.define('atlas-button', AtlasButton);
