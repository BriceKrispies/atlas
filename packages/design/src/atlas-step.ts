import { AtlasElement } from '@atlas/core';

/**
 * <atlas-step> — single step inside an `<atlas-stepper>`.
 *
 * Shadow DOM. The dot/numeral and the connector line are drawn by this
 * element; the step label comes from slotted children (default slot).
 *
 * Attributes:
 *   value    — required; identifies the step in `step-click` events.
 *   label    — optional; if set, used as the visible label. Otherwise the
 *              default slot is used.
 *   status   — pending | current | complete | error (default: pending)
 *   disabled — non-interactive (still readable)
 *
 * The parent stepper sets `data-index`, `data-clickable`, and `data-last`
 * on each step so the step doesn't need to know its own position. We
 * read those attributes in `_syncDot()`.
 */

import { adoptSheet, createSheet } from './util.ts';

const sheet = createSheet(`
  :host {
    display: flex;
    align-items: stretch;
    flex: 1 1 0%;
    min-width: 0;
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
  }
  /* In a horizontal stepper the step is a column with the dot on top
     and the label underneath. The connector line draws to the right of
     the dot (towards the next step). */
  :host { flex-direction: column; }
  .row {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
  }
  .dot {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    min-width: var(--atlas-touch-target-min, 44px);
    min-height: var(--atlas-touch-target-min, 44px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--atlas-color-bg);
    border: 2px solid var(--atlas-color-border);
    color: var(--atlas-color-text-muted);
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    cursor: default;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast),
                border-color var(--atlas-transition-fast),
                color var(--atlas-transition-fast);
  }
  /* The dot itself is a button when clickable; otherwise a span. */
  button.dot { cursor: pointer; padding: 0; font-family: inherit; }
  button.dot:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  :host([status="current"]) .dot {
    background: var(--atlas-color-primary);
    border-color: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse, #fff);
  }
  :host([status="complete"]) .dot {
    background: var(--atlas-color-success-text, #2e7d32);
    border-color: var(--atlas-color-success-text, #2e7d32);
    color: var(--atlas-color-text-inverse, #fff);
  }
  :host([status="error"]) .dot {
    background: var(--atlas-color-danger);
    border-color: var(--atlas-color-danger);
    color: var(--atlas-color-text-inverse, #fff);
  }
  :host([disabled]) {
    opacity: 0.5;
  }
  :host([disabled]) button.dot { cursor: not-allowed; }

  .connector {
    flex: 1 1 auto;
    height: 2px;
    background: var(--atlas-color-border);
    border-radius: 1px;
    align-self: center;
  }
  :host([status="complete"]) .connector,
  :host([status="current"]) .connector {
    background: var(--atlas-color-primary);
  }
  :host([data-last]) .connector {
    visibility: hidden;
  }

  .label {
    margin-top: var(--atlas-space-xs);
    padding-left: calc(var(--atlas-touch-target-min, 44px) / 2 - 14px);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text);
    line-height: var(--atlas-line-height-tight, 1.25);
  }
  :host([status="current"]) .label { font-weight: var(--atlas-font-weight-medium); }
  :host([status="error"]) .label { color: var(--atlas-color-danger); }

  /* Vertical layout — switches when the host stepper has
     orientation="vertical" OR is in mobile auto-switch mode. */
  :host-context(atlas-stepper[orientation="vertical"]) {
    flex-direction: row;
  }
  :host-context(atlas-stepper[orientation="vertical"]) .row {
    flex-direction: column;
    align-items: center;
    align-self: stretch;
  }
  :host-context(atlas-stepper[orientation="vertical"]) .connector {
    width: 2px;
    height: auto;
    flex: 1 1 auto;
  }
  :host-context(atlas-stepper[orientation="vertical"]) .label {
    margin-top: 0;
    margin-left: var(--atlas-space-md);
    padding-left: 0;
    align-self: center;
  }

  /* Mobile auto-switch — only when stepper has NO explicit orientation
     attr. Mirrors --atlas-bp-sm. */
  @media (max-width: 639px) {
    :host-context(atlas-stepper:not([orientation])) {
      flex-direction: row;
    }
    :host-context(atlas-stepper:not([orientation])) .row {
      flex-direction: column;
      align-items: center;
      align-self: stretch;
    }
    :host-context(atlas-stepper:not([orientation])) .connector {
      width: 2px;
      height: auto;
      flex: 1 1 auto;
    }
    :host-context(atlas-stepper:not([orientation])) .label {
      margin-top: 0;
      margin-left: var(--atlas-space-md);
      padding-left: 0;
      align-self: center;
    }
  }
`);

export class AtlasStep extends AtlasElement {
  declare value: string;
  declare label: string;
  declare status: string;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'value', AtlasElement.strAttr('value', ''));
    Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', ''));
    Object.defineProperty(this.prototype, 'status', AtlasElement.strAttr('status', 'pending'));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['status', 'label', 'data-index', 'data-clickable', 'data-last', 'disabled'];
  }

  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'listitem');
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'data-clickable' || name === 'data-index' || name === 'disabled') {
      // These affect the dot's element (button vs span) — rebuild it.
      this._rebuildDot();
      return;
    }
    if (name === 'label') this._syncLabel();
    if (name === 'status') this._syncAria();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    root.innerHTML = `
      <div class="row">
        <span data-part="dot-slot"></span>
        <span class="connector" aria-hidden="true"></span>
      </div>
      <div class="label" data-part="label"></div>
    `;
    this._built = true;
    this._rebuildDot();
    this._syncLabel();
    this._syncAria();
  }

  private _syncAll(): void {
    this._rebuildDot();
    this._syncLabel();
    this._syncAria();
  }

  private _rebuildDot(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const slot = root.querySelector('[data-part="dot-slot"]');
    if (!slot) return;
    const idx = this.getAttribute('data-index') ?? '';
    const clickable = this.hasAttribute('data-clickable');
    const status = this.getAttribute('status') ?? 'pending';
    const disabled = this.hasAttribute('disabled');
    // Inner glyph: ✓ for complete, ! for error, otherwise the index.
    const glyph = status === 'complete' ? '✓' : status === 'error' ? '!' : idx;
    slot.innerHTML = '';
    if (clickable && !disabled) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dot';
      btn.setAttribute('data-part', 'dot');
      btn.setAttribute('aria-label', this._dotAriaLabel());
      btn.textContent = glyph;
      slot.appendChild(btn);
    } else {
      const span = document.createElement('span');
      span.className = 'dot';
      span.setAttribute('data-part', 'dot');
      span.setAttribute('aria-hidden', 'true');
      span.textContent = glyph;
      slot.appendChild(span);
    }
  }

  private _dotAriaLabel(): string {
    const idx = this.getAttribute('data-index') ?? '';
    const status = this.getAttribute('status') ?? 'pending';
    const label = this.getAttribute('label');
    const head = idx ? `Step ${idx}` : 'Step';
    const labelPart = label ? `: ${label}` : '';
    return `${head}${labelPart} (${status})`;
  }

  private _syncLabel(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const labelEl = root.querySelector<HTMLElement>('[data-part="label"]');
    if (!labelEl) return;
    const attr = this.getAttribute('label');
    if (attr) {
      labelEl.textContent = '';
      labelEl.appendChild(document.createTextNode(attr));
    } else {
      // Fall back to a slotted children projection — but we use shadow
      // DOM here, so we expose a default slot for the label content.
      const slot = document.createElement('slot');
      labelEl.textContent = '';
      labelEl.appendChild(slot);
    }
  }

  private _syncAria(): void {
    const status = this.getAttribute('status') ?? 'pending';
    if (status === 'current') this.setAttribute('aria-current', 'step');
    else this.removeAttribute('aria-current');
  }
}

AtlasElement.define('atlas-step', AtlasStep);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-step': AtlasStep;
  }
}
