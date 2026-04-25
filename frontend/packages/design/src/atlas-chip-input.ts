import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText, uid } from './util.ts';

/**
 * <atlas-chip-input> — combobox-style text field that commits typed entries
 * into chips on Enter / Comma / Tab. Form-associated (component-conventions
 * §6): participates in `<form>` + `FormData`.
 *
 * **Form-association value format**
 * We submit the full set as ONE FormData entry per value, appended under
 * the element's `name` (mirrors how `<select multiple>` submits and how
 * `<atlas-multi-select>` already does it). When `name` is absent, we fall
 * back to a JSON string so a consumer reading
 * `internals.formData.get(...)` still gets a structured payload they can
 * round-trip. This keeps the wire format consistent with multi-select while
 * tolerating the no-name case the constitution doesn't formally require for
 * non-submitting widgets.
 *
 * Attributes:
 *   label       — required (C3.2). Renders a visible <label>.
 *   placeholder — input placeholder text.
 *   disabled    — disables the whole control.
 *   max         — int. Caps the number of chips. Once reached, further
 *                 input is rejected with a setValidity error.
 *   duplicates  — allow (default) | block. When "block", repeat values
 *                 are silently dropped on commit and an inline error is
 *                 raised.
 *   validate    — regex source (no flags). Each commit must match. Invalid
 *                 entries are blocked and an inline error is raised.
 *
 * Keyboard:
 *   Enter / Comma / Tab — commit current input as a chip.
 *   Backspace on empty input — remove the most recent chip.
 *
 * Events:
 *   change — fires after each successful commit/remove with
 *            { values: string[] }.
 */

const sheet = createSheet(`
  :host {
    display: block;
    font-family: var(--atlas-font-family);
  }
  :host([disabled]) {
    opacity: 0.6;
    pointer-events: none;
  }
  label.field-label {
    display: block;
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
    margin-bottom: var(--atlas-space-xs);
  }
  .control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--atlas-space-xs);
    /* WCAG 2.5.5: keep at least 44px in the resting state, even before
       any chips are added. */
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    box-sizing: border-box;
    cursor: text;
    -webkit-tap-highlight-color: transparent;
    transition: border-color var(--atlas-transition-fast);
  }
  .control:focus-within {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }
  :host([data-invalid]) .control {
    border-color: var(--atlas-color-danger);
  }
  .chips {
    display: contents;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    padding: 2px var(--atlas-space-xs) 2px var(--atlas-space-sm);
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    border: 1px solid transparent;
    border-radius: 999px;
    font-size: var(--atlas-font-size-sm);
    line-height: var(--atlas-line-height-tight);
    max-width: 100%;
  }
  .chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip-remove {
    position: relative;
    width: 20px; height: 20px;
    border: none; background: transparent;
    color: inherit; cursor: pointer; padding: 0;
    border-radius: var(--atlas-radius-sm);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 14px; line-height: 1;
    -webkit-tap-highlight-color: transparent;
  }
  .chip-remove::before {
    content: ''; position: absolute; inset: -12px; /* touch slop */
  }
  .chip-remove:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  input {
    flex: 1 0 120px;
    min-width: 80px;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    /* 16px floor suppresses iOS zoom-on-focus. */
    font-size: max(16px, var(--atlas-font-size-md));
    line-height: var(--atlas-line-height);
    padding: 4px 0;
  }
  input::placeholder {
    color: var(--atlas-color-text-muted);
  }
  .error {
    margin-top: var(--atlas-space-xs);
    color: var(--atlas-color-danger);
    font-size: var(--atlas-font-size-sm);
    min-height: 1em;
  }
`);

export interface AtlasChipInputChangeDetail {
  values: string[];
}

export class AtlasChipInput extends AtlasElement {
  static formAssociated = true;

  declare placeholder: string;
  declare disabled: boolean;
  declare label: string;
  declare duplicates: string;

  static {
    Object.defineProperty(this.prototype, 'placeholder', AtlasElement.strAttr('placeholder', ''));
    Object.defineProperty(this.prototype, 'disabled',    AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'label',       AtlasElement.strAttr('label', ''));
    Object.defineProperty(this.prototype, 'duplicates',  AtlasElement.strAttr('duplicates', 'allow'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['label', 'placeholder', 'disabled', 'max', 'duplicates', 'validate'];
  }

  private readonly _internals: ElementInternals;
  private readonly _inputId = uid('atlas-chip-input');
  private readonly _errorId = uid('atlas-chip-input-err');
  private _values: string[] = [];
  private _built = false;
  private _externalError = '';

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
  }

  // ── Property API ─────────────────────────────────────────────

  get values(): string[] {
    return this._values.slice();
  }
  set values(next: unknown) {
    const arr = Array.isArray(next) ? next.map((v) => String(v)) : [];
    this._values = this._dedupeIfBlocking(arr);
    if (this._built) this._renderChips();
    this._commit();
  }

  get max(): number | null {
    const v = Number.parseInt(this.getAttribute('max') ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  set max(v: number | null) {
    if (v == null) this.removeAttribute('max');
    else this.setAttribute('max', String(Math.floor(v)));
  }

  get validate(): RegExp | null {
    const src = this.getAttribute('validate');
    if (!src) return null;
    try {
      return new RegExp(src);
    } catch {
      return null;
    }
  }

  /** Read-only public hook for surfaces that want to display a custom error. */
  setError(message: string): void {
    this._externalError = message;
    this._renderError();
    this._refreshValidity();
  }

  // ── Lifecycle ────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
    this._commit();
  }

  override attributeChangedCallback(): void {
    if (!this._built) return;
    this._syncAll();
  }

  // ── Build / render ───────────────────────────────────────────

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const labelText = this.getAttribute('label') ?? '';
    const placeholder = this.getAttribute('placeholder') ?? '';
    root.innerHTML = `
      ${labelText ? `<label class="field-label" for="${escapeAttr(this._inputId)}">${escapeText(labelText)}</label>` : ''}
      <div class="control" part="control">
        <span class="chips" part="chips"></span>
        <input
          id="${escapeAttr(this._inputId)}"
          type="text"
          part="input"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="${escapeAttr(placeholder)}"
          aria-describedby="${escapeAttr(this._errorId)}"
        />
      </div>
      <div class="error" id="${escapeAttr(this._errorId)}" role="alert" aria-live="polite"></div>
    `;

    const control = root.querySelector<HTMLElement>('.control');
    const input = root.querySelector<HTMLInputElement>('input');

    // Tapping the wrapper focuses the input — emulating native field UX.
    control?.addEventListener('mousedown', (e) => {
      const target = e.target as Element | null;
      if (target?.closest('.chip-remove')) return;
      if (target === input) return;
      e.preventDefault(); // don't blur on a wrapper tap
      input?.focus();
    });

    input?.addEventListener('keydown', (e) => this._onKey(e));
    input?.addEventListener('blur', () => {
      // Commit on blur if the consumer typed but never hit Enter — matches
      // the “tab away” behaviour users expect from chip inputs in mature
      // form libraries. We reuse Tab's commit path.
      const v = input.value.trim();
      if (v) this._commitText(v);
    });

    // Delegated remove handler for chips.
    const chipsEl = root.querySelector<HTMLElement>('.chips');
    chipsEl?.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      const btn = target?.closest<HTMLElement>('.chip-remove');
      if (!btn) return;
      const idx = Number.parseInt(btn.dataset['index'] ?? '', 10);
      if (Number.isFinite(idx)) this._removeAt(idx);
      input?.focus();
    });

    this._built = true;
    this._renderChips();
    this._renderError();
  }

  private _syncAll(): void {
    if (!this._built) return;
    const root = this.shadowRoot;
    if (!root) return;
    // Label may have come/gone — repaint the label region surgically.
    const labelText = this.getAttribute('label') ?? '';
    let labelEl = root.querySelector<HTMLLabelElement>('label.field-label');
    if (labelText) {
      if (!labelEl) {
        labelEl = document.createElement('label');
        labelEl.className = 'field-label';
        labelEl.setAttribute('for', this._inputId);
        root.insertBefore(labelEl, root.firstChild);
      }
      labelEl.textContent = labelText;
    } else if (labelEl) {
      labelEl.remove();
    }

    const input = root.querySelector<HTMLInputElement>('input');
    if (input) {
      input.placeholder = this.getAttribute('placeholder') ?? '';
      input.disabled = this.hasAttribute('disabled');
    }

    // If duplicates rule tightened, drop existing duplicates.
    const deduped = this._dedupeIfBlocking(this._values);
    if (deduped.length !== this._values.length) {
      this._values = deduped;
      this._renderChips();
      this._commit();
    }

    // If max shrank below current count, trim the tail.
    const max = this.max;
    if (max != null && this._values.length > max) {
      this._values = this._values.slice(0, max);
      this._renderChips();
      this._commit();
    }
  }

  private _renderChips(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const chipsEl = root.querySelector<HTMLElement>('.chips');
    if (!chipsEl) return;
    chipsEl.innerHTML = this._values
      .map(
        (v, i) => `
        <span class="chip" data-index="${i}">
          <span class="chip-label">${escapeText(v)}</span>
          <button type="button" class="chip-remove" data-index="${i}"
                  aria-label="${escapeAttr(`Remove ${v}`)}">×</button>
        </span>`,
      )
      .join('');
  }

  private _renderError(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const errEl = root.querySelector<HTMLElement>(`#${this._errorId}`);
    if (!errEl) return;
    errEl.textContent = this._externalError;
    if (this._externalError) this.setAttribute('data-invalid', '');
    else this.removeAttribute('data-invalid');
  }

  // ── Keyboard / commit ────────────────────────────────────────

  private _onKey(e: KeyboardEvent): void {
    const input = e.currentTarget as HTMLInputElement;
    const v = input.value;
    switch (e.key) {
      case 'Enter':
      case ',':
        e.preventDefault();
        this._commitText(v.trim());
        return;
      case 'Tab':
        // Commit if there's content; let Tab proceed for natural focus
        // movement. We don't preventDefault here so Shift+Tab still works.
        if (v.trim().length > 0) {
          this._commitText(v.trim());
        }
        return;
      case 'Backspace':
        if (v.length === 0 && this._values.length > 0) {
          e.preventDefault();
          this._removeAt(this._values.length - 1);
        }
        return;
    }
  }

  private _commitText(raw: string): void {
    const root = this.shadowRoot;
    const input = root?.querySelector<HTMLInputElement>('input');
    const value = raw.trim();
    if (!value) {
      if (input) input.value = '';
      return;
    }

    // Validation gate.
    const re = this.validate;
    if (re && !re.test(value)) {
      this._externalError = `Invalid entry: "${value}"`;
      this._renderError();
      this._refreshValidity();
      return;
    }

    // Duplicate gate.
    if (this.getAttribute('duplicates') === 'block' && this._values.includes(value)) {
      this._externalError = `Duplicate entry: "${value}"`;
      this._renderError();
      this._refreshValidity();
      return;
    }

    // Max gate.
    const max = this.max;
    if (max != null && this._values.length >= max) {
      this._externalError = `At most ${max} entries`;
      this._renderError();
      this._refreshValidity();
      return;
    }

    this._values = [...this._values, value];
    if (input) input.value = '';
    this._externalError = '';
    this._renderChips();
    this._renderError();
    this._emitChange();
    this._commit();
  }

  private _removeAt(index: number): void {
    if (index < 0 || index >= this._values.length) return;
    this._values = this._values.filter((_, i) => i !== index);
    this._externalError = '';
    this._renderChips();
    this._renderError();
    this._emitChange();
    this._commit();
  }

  private _dedupeIfBlocking(arr: string[]): string[] {
    if (this.getAttribute('duplicates') !== 'block') return arr;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of arr) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  private _emitChange(): void {
    const detail: AtlasChipInputChangeDetail = { values: this.values };
    this.dispatchEvent(
      new CustomEvent<AtlasChipInputChangeDetail>('change', {
        detail, bubbles: true, composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (this.surfaceId && name) {
      this.emit(`${this.surfaceId}.${name}-changed`, { values: detail.values });
    }
  }

  /**
   * Mirror current values into ElementInternals.
   *
   * Shape choice:
   *   - When `name` is set (the normal form case): one FormData entry per
   *     value, all under the same `name`. This matches `<select multiple>`
   *     and `<atlas-multi-select>` and lets server frameworks read them as
   *     `request.form.getlist("tags")` / `formData.getAll("tags")`.
   *   - Without a `name`: a JSON-encoded string. Submitters won't see it
   *     (no name → not submitted), but consumers reading
   *     `internals.formData` programmatically still get a structured value.
   */
  private _commit(): void {
    const name = this.getAttribute('name');
    const values = this._values;
    if (values.length === 0) {
      this._internals.setFormValue(null);
    } else if (name) {
      const fd = new FormData();
      for (const v of values) fd.append(name, v);
      this._internals.setFormValue(fd);
    } else {
      this._internals.setFormValue(JSON.stringify(values));
    }
    this._refreshValidity();
  }

  private _refreshValidity(): void {
    const max = this.max;
    if (this._externalError) {
      this._internals.setValidity(
        { customError: true },
        this._externalError,
      );
      return;
    }
    if (max != null && this._values.length > max) {
      this._internals.setValidity(
        { rangeOverflow: true },
        `At most ${max} entries`,
      );
      return;
    }
    this._internals.setValidity({});
  }
}

AtlasElement.define('atlas-chip-input', AtlasChipInput);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-chip-input': AtlasChipInput;
  }
}
