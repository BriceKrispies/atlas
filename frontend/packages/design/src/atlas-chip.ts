import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-chip> — interactive chip. Three flavours:
 *   filter — toggleable (selected/unselected) per Material filter chips
 *   choice — toggleable; typically used inside a single-select chip-group
 *   input  — author-created chip inside an <atlas-chip-input>; usually
 *            removable but never selectable
 *
 * Events:
 *   change — fires on toggle for filter/choice variants. detail.selected
 *            is the new state.
 *   remove — fires when the × button is activated. detail.value carries
 *            the chip's `value` attribute (or text content when absent).
 *
 * The host is a 44×44 touch target on coarse pointers regardless of the
 * visual padding (C16.2). The remove button is its own focus stop with
 * an additional invisible slop area so it doesn't intercept taps meant
 * for the chip body.
 */

const sheet = createSheet(`
  :host {
    --chip-bg: var(--atlas-color-surface);
    --chip-fg: var(--atlas-color-text);
    --chip-border: var(--atlas-color-border);
    display: inline-flex;
    box-sizing: border-box;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    /* WCAG 2.5.5: 44×44 touch target on coarse pointers. */
    min-height: var(--atlas-touch-target-min, 44px);
  }
  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    min-height: 32px;
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
    background: var(--chip-bg);
    color: var(--chip-fg);
    border: 1px solid var(--chip-border);
    border-radius: 999px;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    font-family: inherit;
    font-size: inherit;
    line-height: 1.4;
    transition: background var(--atlas-transition-fast),
                border-color var(--atlas-transition-fast),
                color var(--atlas-transition-fast);
  }
  /* Coarse pointer: grow to the touch-target minimum. */
  @media (pointer: coarse) {
    .chip { min-height: var(--atlas-touch-target-min, 44px); }
  }
  .chip:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  .chip:hover {
    background: var(--atlas-color-surface-hover);
    border-color: var(--atlas-color-border-strong);
  }

  :host([selected]) .chip {
    --chip-bg: var(--atlas-color-primary-subtle);
    --chip-fg: var(--atlas-color-primary);
    --chip-border: var(--atlas-color-primary);
    border-color: var(--atlas-color-primary);
  }

  :host([variant="input"]) .chip {
    cursor: default;
  }
  :host([variant="input"][selected]) .chip {
    /* input chips don't carry a "selected" state; ignore the attribute. */
    --chip-bg: var(--atlas-color-surface);
    --chip-fg: var(--atlas-color-text);
    --chip-border: var(--atlas-color-border);
  }

  /* Leading checkmark for filter chips when selected. The icon is
     decorative; the host carries aria-pressed. */
  .check {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: none;
  }
  :host([variant="filter"][selected]) .check { display: inline-block; }

  .label {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    white-space: nowrap;
  }

  .remove {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-inline-start: 2px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .remove::before {
    content: '';
    position: absolute;
    inset: -12px; /* invisible touch slop, keeps tap target ≥ 44 */
  }
  .remove:hover {
    background: var(--atlas-color-surface-hover);
  }
  .remove:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 1px;
  }
  .remove svg { width: 10px; height: 10px; pointer-events: none; }
`);

export interface AtlasChipChangeDetail {
  selected: boolean;
  value: string;
}
export interface AtlasChipRemoveDetail {
  value: string;
}

export class AtlasChip extends AtlasElement {
  declare variant: string;
  declare value: string;
  declare selected: boolean;
  declare removable: boolean;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'variant',   AtlasElement.strAttr('variant', 'filter'));
    Object.defineProperty(this.prototype, 'value',     AtlasElement.strAttr('value', ''));
    Object.defineProperty(this.prototype, 'selected',  AtlasElement.boolAttr('selected'));
    Object.defineProperty(this.prototype, 'removable', AtlasElement.boolAttr('removable'));
    Object.defineProperty(this.prototype, 'disabled',  AtlasElement.boolAttr('disabled'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['selected', 'disabled', 'removable', 'variant'];
  }

  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._sync();
  }

  override attributeChangedCallback(): void {
    if (!this._built) return;
    this._sync();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    root.innerHTML = `
      <button type="button" class="chip" part="chip">
        <svg class="check" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8l3.5 3.5L13 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="label" part="label"><slot></slot></span>
        <button type="button" class="remove" part="remove" aria-label="Remove" hidden>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </button>
    `;
    const chipBtn = root.querySelector<HTMLButtonElement>('.chip');
    const removeBtn = root.querySelector<HTMLButtonElement>('.remove');

    chipBtn?.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      if (target?.closest('.remove')) return; // remove handles its own click
      this._onActivate();
    });
    chipBtn?.addEventListener('keydown', (e) => {
      // <button> already activates on Enter/Space, so we only need to
      // ensure Space doesn't scroll the page when focus is on the chip.
      if (e.key === ' ' || e.key === 'Spacebar') e.preventDefault();
    });

    removeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onRemove();
    });

    this._built = true;
  }

  private _sync(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const chipBtn = root.querySelector<HTMLButtonElement>('.chip');
    const removeBtn = root.querySelector<HTMLButtonElement>('.remove');
    if (!chipBtn || !removeBtn) return;

    const variant = this.getAttribute('variant') ?? 'filter';
    const isToggle = variant === 'filter' || variant === 'choice';
    const disabled = this.hasAttribute('disabled');
    const selected = this.hasAttribute('selected');

    chipBtn.disabled = disabled;
    if (isToggle) {
      chipBtn.setAttribute('role', 'button');
      chipBtn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    } else {
      chipBtn.removeAttribute('aria-pressed');
    }

    if (this.hasAttribute('removable')) {
      removeBtn.hidden = false;
      const labelText = this.textContent?.trim() || this.getAttribute('value') || 'chip';
      removeBtn.setAttribute('aria-label', `Remove ${labelText}`);
    } else {
      removeBtn.hidden = true;
    }
  }

  private _resolvedValue(): string {
    return this.getAttribute('value') ?? this.textContent?.trim() ?? '';
  }

  private _onActivate(): void {
    if (this.hasAttribute('disabled')) return;
    const variant = this.getAttribute('variant') ?? 'filter';
    if (variant !== 'filter' && variant !== 'choice') return;

    const next = !this.hasAttribute('selected');
    if (next) this.setAttribute('selected', '');
    else this.removeAttribute('selected');

    const detail: AtlasChipChangeDetail = {
      selected: next,
      value: this._resolvedValue(),
    };
    this.dispatchEvent(new CustomEvent<AtlasChipChangeDetail>('change', {
      detail, bubbles: true, composed: true,
    }));

    const name = this.getAttribute('name');
    if (this.surfaceId && name) {
      this.emit(`${this.surfaceId}.${name}-changed`, { ...detail });
    }
  }

  private _onRemove(): void {
    if (this.hasAttribute('disabled')) return;
    const detail: AtlasChipRemoveDetail = { value: this._resolvedValue() };
    this.dispatchEvent(new CustomEvent<AtlasChipRemoveDetail>('remove', {
      detail, bubbles: true, composed: true,
    }));
    const name = this.getAttribute('name');
    if (this.surfaceId && name) {
      this.emit(`${this.surfaceId}.${name}-removed`, { ...detail });
    }
  }
}

AtlasElement.define('atlas-chip', AtlasChip);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-chip': AtlasChip;
  }
}
