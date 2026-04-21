import { AtlasElement } from '@atlas/core';

const styles = `
  :host {
    display: inline-flex;
    gap: var(--atlas-space-xs);
    padding: 2px;
    border-radius: var(--atlas-radius-sm);
    background: var(--atlas-color-surface);
    border: 1px solid var(--atlas-color-border);
  }
  button {
    flex: 1;
    min-width: 0;
    padding: 4px var(--atlas-space-md);
    border: none;
    border-radius: calc(var(--atlas-radius-sm) - 2px);
    background: transparent;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    transition: background var(--atlas-transition-fast),
                color var(--atlas-transition-fast);
    text-transform: capitalize;
    white-space: nowrap;
  }
  button:hover {
    background: var(--atlas-color-surface-hover);
    color: var(--atlas-color-text);
  }
  button[aria-selected="true"] {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 1px;
  }
  :host([size="sm"]) button {
    font-size: var(--atlas-font-size-xs);
    padding: 2px var(--atlas-space-sm);
  }
  :host([stretch]) {
    display: flex;
    width: 100%;
  }
`;

/**
 * <atlas-tab-bar> — segmented tab switcher.
 *
 * Declarative tab list + selected value. Emits a `change` event with
 * `detail.value` when the user picks a tab. Implements WAI-ARIA
 * tablist pattern (arrow keys, Home/End).
 *
 * API:
 *   .tabs = [{ value: 'edit', label: 'Edit' }, ...]
 *   .value = 'edit'
 *   // events: 'change' → { detail: { value, previousValue } }
 *
 * Attributes:
 *   name      — required for auto-testid: each inner tab becomes
 *               `${surfaceId}.${name}.${tabValue}`
 *   size      — "sm" for compact sizing
 *   stretch   — fill parent width
 *   aria-label — accessible label for the tablist
 */
class AtlasTabBar extends AtlasElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    /** @type {Array<{ value: string, label: string }>} */
    this._tabs = [];
    /** @type {string | null} */
    this._value = null;
  }

  get tabs() {
    return this._tabs;
  }
  set tabs(next) {
    this._tabs = Array.isArray(next) ? next.map((t) => ({ value: String(t.value), label: String(t.label ?? t.value) })) : [];
    if (this._value && !this._tabs.some((t) => t.value === this._value)) {
      this._value = null;
    }
    this._render();
  }

  get value() {
    return this._value;
  }
  set value(next) {
    const v = next == null ? null : String(next);
    if (v === this._value) return;
    this._value = v;
    this._render();
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'tablist');
    this._render();
  }

  attributeChangedCallback(name) {
    if (name === 'name') this._render();
  }

  static get observedAttributes() {
    return ['name'];
  }

  _testIdFor(value) {
    const sid = this.surfaceId;
    const barName = this.getAttribute('name');
    if (!sid || !barName) return null;
    return `${sid}.${barName}.${value}`;
  }

  _render() {
    if (!this.shadowRoot) return;
    const tabs = this._tabs;
    const selected = this._value;
    const rendered = tabs
      .map((t) => {
        const isSel = t.value === selected;
        const testId = this._testIdFor(t.value);
        const testIdAttr = testId ? ` data-testid="${testId}"` : '';
        return `<button type="button" role="tab" data-value="${t.value}" aria-selected="${isSel}" tabindex="${isSel ? '0' : '-1'}"${testIdAttr}>${t.label}</button>`;
      })
      .join('');
    this.shadowRoot.innerHTML = `<style>${styles}</style>${rendered}`;
    this._wire();
  }

  _wire() {
    const buttons = Array.from(this.shadowRoot.querySelectorAll('button[role="tab"]'));
    for (const btn of buttons) {
      btn.addEventListener('click', () => this._select(btn.dataset.value));
      btn.addEventListener('keydown', (ev) => this._onKey(ev, buttons));
    }
  }

  _onKey(ev, buttons) {
    const idx = buttons.indexOf(ev.currentTarget);
    if (idx < 0) return;
    let next = -1;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % buttons.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      case 'Enter':
      case ' ':
        this._select(ev.currentTarget.dataset.value);
        ev.preventDefault();
        return;
      default:
        return;
    }
    ev.preventDefault();
    const target = buttons[next];
    target.focus();
    this._select(target.dataset.value);
  }

  _select(value) {
    if (value == null || value === this._value) return;
    const previousValue = this._value;
    this._value = value;
    this._render();
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { value, previousValue },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

AtlasElement.define('atlas-tab-bar', AtlasTabBar);
