import { AtlasElement } from '@atlas/core';

const styles = `
  :host {
    /* Mobile-first: horizontal-scroll tab strip with snap points. On narrow
       viewports users swipe to reach tabs that don't fit; on wider viewports
       (and with [stretch]) tabs flex equally. */
    display: flex;
    gap: var(--atlas-space-xs);
    padding: 3px;
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-surface);
    border: 1px solid var(--atlas-color-border);
    max-width: 100%;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  :host::-webkit-scrollbar { display: none; }
  button {
    flex: 0 0 auto;
    min-width: 0;
    /* 44×44 touch target. */
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: none;
    border-radius: calc(var(--atlas-radius-md) - 2px);
    background: transparent;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    scroll-snap-align: start;
    -webkit-tap-highlight-color: transparent;
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
  /* Desktop: tabs flex equally, strip stops scrolling. Mirrors the JS
     BREAKPOINTS.sm value. */
  @media (min-width: 640px) {
    :host {
      overflow-x: visible;
      scroll-snap-type: none;
    }
    button { flex: 1; }
  }
  :host([size="sm"]) button {
    font-size: var(--atlas-font-size-xs);
    /* sm stays compact visually but preserves the touch target on touch. */
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
  }
  :host([stretch]) {
    width: 100%;
  }
  @media (hover: none) {
    button:hover {
      background: transparent;
      color: var(--atlas-color-text-muted);
    }
    button[aria-selected="true"]:hover {
      background: var(--atlas-color-primary);
      color: var(--atlas-color-text-inverse);
    }
  }
`;

export interface TabDefinition {
  value: string;
  label: string;
}

interface RawTabInput {
  value: unknown;
  label?: unknown;
}

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
  private _tabs: TabDefinition[] = [];
  private _value: string | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get tabs(): TabDefinition[] {
    return this._tabs;
  }
  set tabs(next: readonly RawTabInput[] | null | undefined) {
    this._tabs = Array.isArray(next)
      ? next.map((t) => ({
          value: String(t.value),
          label: String(t.label ?? t.value),
        }))
      : [];
    if (this._value && !this._tabs.some((t) => t.value === this._value)) {
      this._value = null;
    }
    this._render();
  }

  get value(): string | null {
    return this._value;
  }
  set value(next: string | null | undefined) {
    const v = next == null ? null : String(next);
    if (v === this._value) return;
    this._value = v;
    this._render();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'tablist');
    this._render();
  }

  override attributeChangedCallback(name: string): void {
    if (name === 'name') this._render();
  }

  static override get observedAttributes(): string[] {
    return ['name'];
  }

  private _testIdFor(value: string): string | null {
    const sid = this.surfaceId;
    const barName = this.getAttribute('name');
    if (!sid || !barName) return null;
    return `${sid}.${barName}.${value}`;
  }

  private _render(): void {
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

  private _wire(): void {
    if (!this.shadowRoot) return;
    const buttons = Array.from(
      this.shadowRoot.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
    );
    for (const btn of buttons) {
      btn.addEventListener('click', () => this._select(btn.dataset['value'] ?? null));
      btn.addEventListener('keydown', (ev) => this._onKey(ev, buttons));
    }
  }

  private _onKey(ev: KeyboardEvent, buttons: HTMLButtonElement[]): void {
    const current = ev.currentTarget as HTMLButtonElement | null;
    if (!current) return;
    const idx = buttons.indexOf(current);
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
        this._select(current.dataset['value'] ?? null);
        ev.preventDefault();
        return;
      default:
        return;
    }
    ev.preventDefault();
    const target = buttons[next];
    if (!target) return;
    target.focus();
    this._select(target.dataset['value'] ?? null);
  }

  private _select(value: string | null): void {
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
