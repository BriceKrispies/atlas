import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText, uid } from './util.ts';
import './atlas-icon.ts';

const sheet = createSheet(`
  :host {
    display: block;
    font-family: var(--atlas-font-family);
  }
  label.legend {
    display: block;
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
    margin-bottom: var(--atlas-space-xs);
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--atlas-space-xs);
    padding: var(--atlas-space-xl);
    border: 2px dashed var(--atlas-color-border-strong);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-surface);
    text-align: center;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    transition: background var(--atlas-transition-fast),
                border-color var(--atlas-transition-fast);
    -webkit-tap-highlight-color: transparent;
    min-height: var(--atlas-touch-target-min, 44px);
  }
  .drop:hover,
  .drop:focus-visible {
    outline: none;
    border-color: var(--atlas-color-primary);
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-text);
  }
  :host([dragging]) .drop {
    border-color: var(--atlas-color-primary);
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-text);
  }
  :host([disabled]) .drop {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .drop atlas-icon { width: 28px; height: 28px; color: var(--atlas-color-text-muted); }
  .primary { color: var(--atlas-color-text); font-weight: var(--atlas-font-weight-medium); }
  .hint { font-size: var(--atlas-font-size-sm); }
  input[type="file"] {
    position: absolute;
    width: 1px; height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .files {
    list-style: none;
    margin: var(--atlas-space-sm) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-xs);
  }
  .files li {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
    background: var(--atlas-color-bg);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    font-size: var(--atlas-font-size-sm);
  }
  .files .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .files .size {
    color: var(--atlas-color-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .files button {
    border: none;
    background: transparent;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--atlas-radius-sm);
    -webkit-tap-highlight-color: transparent;
  }
  .files button:hover { color: var(--atlas-color-danger); background: var(--atlas-color-danger-subtle); }
  .files button atlas-icon { width: 14px; height: 14px; display: block; }
  .error {
    margin-top: var(--atlas-space-xs);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-danger);
  }
`);

export interface AtlasFileUploadChangeDetail {
  files: readonly File[];
}

/**
 * `<atlas-file-upload>` — drop zone + click-to-browse file picker.
 *
 * When to use: attach-file fields, image/document uploads.
 * When NOT to use: for plain URL entry, use `<atlas-input type="url">`.
 *
 * Attributes:
 *   label, name, disabled, required
 *   accept       — MIME pattern, e.g. "image/*"
 *   multiple     — allow multi-select
 *   max-size     — per-file size limit in bytes; files over are rejected
 *
 * Events:
 *   change → CustomEvent<AtlasFileUploadChangeDetail> on selection / drop / removal
 *
 * Form-associated: submits selected files as FormData entries keyed by `name`.
 */
export class AtlasFileUpload extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return ['label', 'disabled', 'accept', 'multiple', 'max-size', 'required'];
  }

  declare disabled: boolean;
  declare required: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'disabled',
      AtlasElement.boolAttr('disabled'),
    );
    Object.defineProperty(
      this.prototype,
      'required',
      AtlasElement.boolAttr('required'),
    );
  }

  private readonly _inputId = uid('atlas-fu');
  private readonly _internals: ElementInternals;
  private _files: File[] = [];
  private _error: string | null = null;
  private _built = false;
  private _drop: HTMLElement | null = null;
  private _input: HTMLInputElement | null = null;
  private _label: HTMLLabelElement | null = null;
  private _hint: HTMLSpanElement | null = null;
  private _list: HTMLUListElement | null = null;
  private _errorEl: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
  }

  get files(): readonly File[] {
    return this._files;
  }

  clear(): void {
    this._files = [];
    this._error = null;
    this._renderFiles();
    this._emit();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
    this._commit();
  }

  override attributeChangedCallback(
    name: string,
    oldVal: string | null,
    newVal: string | null,
  ): void {
    if (!this._built) return;
    if (oldVal === newVal) return;
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label');
    const accept = this.getAttribute('accept') ?? '';
    const multiple = this.hasAttribute('multiple');
    const disabled = this.disabled;
    const required = this.required;

    root.innerHTML = `
      ${
        label != null
          ? `<label class="legend" for="${escapeAttr(this._inputId)}">${escapeText(label)}</label>`
          : ''
      }
      <div class="drop" tabindex="${disabled ? -1 : 0}" role="button" aria-label="Upload files">
        <atlas-icon name="upload"></atlas-icon>
        <span class="primary">Drop files or click to browse</span>
        <span class="hint">${escapeText(
          `${multiple ? 'Multiple files allowed' : 'One file'}${accept ? ` · ${accept}` : ''}`,
        )}</span>
        <input
          id="${escapeAttr(this._inputId)}"
          type="file"
          ${accept ? `accept="${escapeAttr(accept)}"` : ''}
          ${multiple ? 'multiple' : ''}
          ${disabled ? 'disabled' : ''}
          ${required ? 'required' : ''}
        />
      </div>
      <ul class="files" aria-live="polite"></ul>
      <div class="error" aria-live="polite"></div>
    `;

    this._drop = root.querySelector<HTMLElement>('.drop');
    this._input = root.querySelector<HTMLInputElement>('input[type="file"]');
    this._label = root.querySelector<HTMLLabelElement>('label.legend');
    this._hint = root.querySelector<HTMLSpanElement>('.hint');
    this._list = root.querySelector<HTMLUListElement>('.files');
    this._errorEl = root.querySelector<HTMLElement>('.error');

    const drop = this._drop;
    const input = this._input;
    if (!drop || !input) return;

    drop.addEventListener('click', () => {
      if (!this.disabled) input.click();
    });
    drop.addEventListener('keydown', (ev) => {
      if (this.disabled) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        input.click();
      }
    });
    drop.addEventListener('dragover', (ev) => {
      if (this.disabled) return;
      ev.preventDefault();
      this.setAttribute('dragging', '');
    });
    drop.addEventListener('dragleave', () => this.removeAttribute('dragging'));
    drop.addEventListener('drop', (ev) => {
      ev.preventDefault();
      this.removeAttribute('dragging');
      if (this.disabled) return;
      const dropped = Array.from(ev.dataTransfer?.files ?? []);
      this._setFiles(dropped);
    });
    input.addEventListener('change', () => {
      const picked = Array.from(input.files ?? []);
      this._setFiles(picked);
      input.value = '';
    });

    // Event delegation on the file list for remove buttons — survives
    // surgical innerHTML replacement of list rows.
    this._list?.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      const btn = target?.closest<HTMLButtonElement>('button[data-idx]');
      if (!btn) return;
      const idx = Number(btn.dataset['idx']);
      if (!Number.isFinite(idx)) return;
      this._files = this._files.filter((_, i) => i !== idx);
      this._renderFiles();
      this._emit();
    });

    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('accept');
    this._sync('multiple');
    this._sync('disabled');
    this._sync('required');
    this._renderFiles();
  }

  private _sync(name: string): void {
    const input = this._input;
    const root = this.shadowRoot;
    if (!input || !root) return;
    switch (name) {
      case 'label': {
        const label = this.getAttribute('label');
        if (label != null) {
          if (!this._label) {
            const lbl = document.createElement('label');
            lbl.className = 'legend';
            lbl.setAttribute('for', this._inputId);
            root.insertBefore(lbl, this._drop);
            this._label = lbl;
          }
          this._label.textContent = label;
        } else if (this._label) {
          this._label.remove();
          this._label = null;
        }
        break;
      }
      case 'accept': {
        const accept = this.getAttribute('accept');
        if (accept == null || accept === '') input.removeAttribute('accept');
        else input.accept = accept;
        this._updateHint();
        break;
      }
      case 'multiple':
        input.multiple = this.hasAttribute('multiple');
        this._updateHint();
        break;
      case 'disabled':
        input.disabled = this.disabled;
        if (this._drop) this._drop.tabIndex = this.disabled ? -1 : 0;
        break;
      case 'required':
        input.required = this.required;
        this._commit();
        break;
      case 'max-size':
        // Re-validate current files against the new max size.
        this._setFiles(this._files.slice());
        break;
    }
  }

  private _updateHint(): void {
    const hint = this._hint;
    if (!hint) return;
    const multiple = this.hasAttribute('multiple');
    const accept = this.getAttribute('accept') ?? '';
    hint.textContent = `${multiple ? 'Multiple files allowed' : 'One file'}${accept ? ` · ${accept}` : ''}`;
  }

  private _setFiles(incoming: File[]): void {
    const maxSize = Number(this.getAttribute('max-size') ?? '');
    const multiple = this.hasAttribute('multiple');
    const valid: File[] = [];
    let error: string | null = null;
    for (const f of incoming) {
      if (Number.isFinite(maxSize) && maxSize > 0 && f.size > maxSize) {
        error = `${f.name} exceeds ${formatBytes(maxSize)}`;
        continue;
      }
      valid.push(f);
    }
    this._files = multiple ? [...this._files, ...valid] : valid.slice(0, 1);
    this._error = error;
    this._renderFiles();
    this._emit();
  }

  private _renderFiles(): void {
    const list = this._list;
    const err = this._errorEl;
    if (!list || !err) return;
    let html = '';
    for (let i = 0; i < this._files.length; i++) {
      const f = this._files[i];
      if (!f) continue;
      html += `
        <li>
          <span class="name" title="${escapeAttr(f.name)}">${escapeText(f.name)}</span>
          <span class="size">${escapeText(formatBytes(f.size))}</span>
          <button type="button" aria-label="${escapeAttr(`Remove ${f.name}`)}" data-idx="${i}">
            <atlas-icon name="x-sm"></atlas-icon>
          </button>
        </li>`;
    }
    list.innerHTML = html;
    err.textContent = this._error ?? '';
  }

  private _emit(): void {
    this._commit();
    this.dispatchEvent(
      new CustomEvent<AtlasFileUploadChangeDetail>('change', {
        detail: { files: this._files.slice() },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, {
        count: this._files.length,
      });
    }
  }

  private _commit(): void {
    const name = this.getAttribute('name');
    if (this._files.length === 0) {
      this._internals.setFormValue(null);
      if (this.required) {
        this._internals.setValidity({ valueMissing: true }, 'Required');
      } else {
        this._internals.setValidity({});
      }
      return;
    }
    // MDN: setFormValue accepts File | FormData | string. For multiple
    // files we wrap each in a FormData entry keyed by `name` (or the
    // element id as a sensible fallback). The browser submits each entry.
    if (this._files.length === 1 && this._files[0]) {
      this._internals.setFormValue(this._files[0]);
    } else {
      const fd = new FormData();
      const key = name ?? this._inputId;
      for (const f of this._files) fd.append(key, f, f.name);
      this._internals.setFormValue(fd);
    }
    this._internals.setValidity({});
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

AtlasElement.define('atlas-file-upload', AtlasFileUpload);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-file-upload': AtlasFileUpload;
  }
}
