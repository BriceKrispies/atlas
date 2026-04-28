import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, uid } from './util.ts';
import './atlas-icon.ts';

const sheet = createSheet(`
  :host {
    display: block;
    font-family: var(--atlas-font-family);
  }
  label.field-label {
    display: block;
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
    margin-bottom: var(--atlas-space-xs);
  }
  label.field-label[hidden] { display: none; }
  .group {
    position: relative;
  }
  select {
    width: 100%;
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) calc(var(--atlas-space-md) * 2 + 8px) var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    font-size: max(16px, var(--atlas-font-size-md));
    font-family: inherit;
    line-height: var(--atlas-line-height);
    color: var(--atlas-color-text);
    background: var(--atlas-color-bg);
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
    transition: border-color var(--atlas-transition-fast);
  }
  select:focus {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }
  select:disabled {
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
  .caret {
    position: absolute;
    right: var(--atlas-space-md);
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--atlas-color-text-muted);
  }
  .caret atlas-icon { width: 12px; height: 12px; display: block; }
  :host([invalid]) select {
    border-color: var(--atlas-color-danger);
  }
`);

export interface AtlasSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface AtlasSelectChangeDetail {
  value: string;
}

interface RawOption {
  value: unknown;
  label?: unknown;
  disabled?: unknown;
}

/**
 * `<atlas-select>` — single-choice dropdown (wraps native `<select>`).
 *
 * When to use: mutually exclusive choice from ~6+ options where a radio
 * group would be too tall.
 * When NOT to use: use `<atlas-radio-group>` for <= 5 options where all
 * should be visible; use `<atlas-multi-select>` for picking multiple values.
 *
 * Native `<select>` is chosen for accessibility: it opens a real OS-level
 * picker on mobile and has proven keyboard handling.
 *
 * API:
 *   .options = [{ value, label, disabled? }, ...]
 *   .value   = 'draft'
 *
 * Attributes:
 *   label, name, placeholder, disabled, required, invalid
 *
 * Events:
 *   change -> CustomEvent<AtlasSelectChangeDetail>
 */
export class AtlasSelect extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return ['label', 'placeholder', 'disabled', 'required'];
  }

  declare disabled: boolean;
  declare required: boolean;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
  }

  private readonly _inputId = uid('atlas-sel');
  private readonly _internals: ElementInternals;
  private _options: AtlasSelectOption[] = [];
  /** Pending value set programmatically before the shell is built, or before
   *  the matching option exists. Flushed when the select is next rendered. */
  private _pendingValue: string | null = null;
  private _built = false;
  private _select: HTMLSelectElement | null = null;
  private _labelEl: HTMLLabelElement | null = null;
  private _onChange = (): void => {
    const sel = this._select;
    if (!sel) return;
    this._pendingValue = sel.value;
    this._commit();
    this.dispatchEvent(
      new CustomEvent<AtlasSelectChangeDetail>('change', {
        detail: { value: sel.value },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, { value: sel.value });
    }
  };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._internals = this.attachInternals();
  }

  get options(): AtlasSelectOption[] {
    return this._options.slice();
  }
  set options(next: readonly RawOption[] | null | undefined) {
    this._options = Array.isArray(next)
      ? next.map((o) => {
          const opt: AtlasSelectOption = {
            value: String(o.value),
            label: String(o.label ?? o.value),
          };
          if (o.disabled === true) opt.disabled = true;
          return opt;
        })
      : [];
    if (this._built) {
      this._rebuildOptions();
      this._applyPendingValue();
      this._commit();
    }
  }

  get value(): string {
    return this._select?.value ?? this._pendingValue ?? '';
  }
  set value(v: string) {
    this._pendingValue = v;
    if (this._select) {
      this._select.value = v;
      this._commit();
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    adoptSheet(root, sheet);
    root.innerHTML = `
      <label class="field-label" for="${escapeAttr(this._inputId)}" hidden></label>
      <div class="group">
        <select id="${escapeAttr(this._inputId)}"></select>
        <span class="caret" aria-hidden="true">
          <atlas-icon name="caret-down"></atlas-icon>
        </span>
      </div>
    `;
    this._select = root.querySelector<HTMLSelectElement>('select');
    this._labelEl = root.querySelector<HTMLLabelElement>('label.field-label');
    this._select?.addEventListener('change', this._onChange);
    this._rebuildOptions();
    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('placeholder');
    this._sync('disabled');
    this._sync('required');
    this._applyPendingValue();
    this._commit();
  }

  private _sync(name: string): void {
    const sel = this._select;
    if (!sel) return;
    switch (name) {
      case 'label': {
        if (!this._labelEl) return;
        const label = this.getAttribute('label') ?? '';
        if (label) {
          this._labelEl.textContent = label;
          this._labelEl.hidden = false;
        } else {
          this._labelEl.textContent = '';
          this._labelEl.hidden = true;
        }
        break;
      }
      case 'placeholder':
        this._syncPlaceholder();
        break;
      case 'disabled':
        sel.disabled = this.disabled;
        break;
      case 'required':
        sel.required = this.required;
        this._commit();
        break;
    }
  }

  /** Rebuild the entire <option> list — call when `.options` is reassigned. */
  private _rebuildOptions(): void {
    const sel = this._select;
    if (!sel) return;
    // Remove all existing options, then reappend. Avoids innerHTML so the
    // live <select> element retains identity (event listeners, focus).
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const placeholder = this.getAttribute('placeholder');
    if (placeholder != null) {
      sel.appendChild(this._buildPlaceholderOption(placeholder));
    }
    for (const o of this._options) {
      const el = document.createElement('option');
      el.value = o.value;
      el.textContent = o.label;
      if (o.disabled) el.disabled = true;
      sel.appendChild(el);
    }
  }

  /** Replace (or insert/remove) only the placeholder <option> node. */
  private _syncPlaceholder(): void {
    const sel = this._select;
    if (!sel) return;
    const first = sel.firstElementChild as HTMLOptionElement | null;
    const existingIsPlaceholder = !!first && first.disabled && first.value === '';
    const placeholder = this.getAttribute('placeholder');
    if (placeholder == null) {
      if (existingIsPlaceholder && first) sel.removeChild(first);
      return;
    }
    const node = this._buildPlaceholderOption(placeholder);
    if (existingIsPlaceholder && first) {
      sel.replaceChild(node, first);
    } else {
      sel.insertBefore(node, sel.firstChild);
    }
  }

  private _buildPlaceholderOption(text: string): HTMLOptionElement {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = text;
    if (!this._pendingValue) opt.selected = true;
    return opt;
  }

  /** If a value was queued (via `.value =` before render or before options
   *  arrived), try to apply it now. */
  private _applyPendingValue(): void {
    const sel = this._select;
    if (!sel) return;
    if (this._pendingValue != null) {
      sel.value = this._pendingValue;
    }
  }

  private _commit(): void {
    const v = this.value;
    this._internals.setFormValue(v);
    if (this.required && !v) {
      this._internals.setValidity(
        { valueMissing: true },
        'Required',
        this._select ?? undefined,
      );
    } else {
      this._internals.setValidity({});
    }
  }
}

AtlasElement.define('atlas-select', AtlasSelect);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-select': AtlasSelect;
  }
}
