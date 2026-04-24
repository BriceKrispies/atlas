import { AtlasElement } from '@atlas/core';

const styles = `
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
  .drop svg { width: 28px; height: 28px; color: var(--atlas-color-text-muted); }
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
  .files button svg { width: 14px; height: 14px; display: block; }
  .error {
    margin-top: var(--atlas-space-xs);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-danger);
  }
`;

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
 *   label, name, disabled
 *   accept       — MIME pattern, e.g. "image/*"
 *   multiple     — allow multi-select
 *   max-size     — per-file size limit in bytes; files over are rejected
 *
 * Events:
 *   change → CustomEvent<AtlasFileUploadChangeDetail>
 */
export class AtlasFileUpload extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'disabled', 'accept', 'multiple', 'max-size'];
  }

  private _inputId = `atlas-fu-${Math.random().toString(36).slice(2, 8)}`;
  private _files: File[] = [];
  private _error: string | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get files(): readonly File[] {
    return this._files;
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  clear(): void {
    this._files = [];
    this._error = null;
    this._renderFiles();
    this._emit();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._render();
  }

  override attributeChangedCallback(): void {
    this._render();
  }

  private _render(): void {
    if (!this.shadowRoot) return;
    const label = this.getAttribute('label');
    const accept = this.getAttribute('accept') ?? '';
    const multiple = this.hasAttribute('multiple');
    const disabled = this.disabled;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${label ? `<label class="legend" for="${this._inputId}">${label}</label>` : ''}
      <div class="drop" tabindex="${disabled ? -1 : 0}" role="button" aria-label="Upload files">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 16V4"/>
          <polyline points="7 9 12 4 17 9"/>
          <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>
        </svg>
        <span class="primary">Drop files or click to browse</span>
        <span class="hint">${multiple ? 'Multiple files allowed' : 'One file'}${accept ? ` · ${accept}` : ''}</span>
        <input
          id="${this._inputId}"
          type="file"
          ${accept ? `accept="${accept}"` : ''}
          ${multiple ? 'multiple' : ''}
          ${disabled ? 'disabled' : ''}
        />
      </div>
      <ul class="files" aria-live="polite"></ul>
      <div class="error" aria-live="polite"></div>
    `;

    const drop = this.shadowRoot.querySelector<HTMLElement>('.drop');
    const input = this.shadowRoot.querySelector<HTMLInputElement>('input[type="file"]');
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

    this._renderFiles();
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
    const list = this.shadowRoot?.querySelector<HTMLUListElement>('.files');
    const err = this.shadowRoot?.querySelector<HTMLElement>('.error');
    if (!list || !err) return;
    list.innerHTML = '';
    for (let i = 0; i < this._files.length; i++) {
      const f = this._files[i];
      if (!f) continue;
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="name" title="${escapeAttr(f.name)}">${escapeText(f.name)}</span>
        <span class="size">${formatBytes(f.size)}</span>
        <button type="button" aria-label="Remove ${escapeAttr(f.name)}" data-idx="${i}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
        </button>
      `;
      list.appendChild(li);
    }
    list.querySelectorAll<HTMLButtonElement>('button[data-idx]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset['idx']);
        this._files = this._files.filter((_, i) => i !== idx);
        this._renderFiles();
        this._emit();
      });
    });
    err.textContent = this._error ?? '';
  }

  private _emit(): void {
    this.dispatchEvent(
      new CustomEvent<AtlasFileUploadChangeDetail>('change', {
        detail: { files: this._files.slice() },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

AtlasElement.define('atlas-file-upload', AtlasFileUpload);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-file-upload': AtlasFileUpload;
  }
}
