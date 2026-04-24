import { AtlasElement } from '@atlas/core';

/**
 * <atlas-command-palette> — Cmd-K style fuzzy-jump overlay. Opens as a
 * modal (via native `<dialog>`) containing a search input and a
 * scrollable result list.
 *
 * Host supplies items via the `.items` property. Each item is
 * `{ id, label, hint?, keywords?, group?, onSelect? }`. Filtering is
 * a simple case-insensitive substring match against label + keywords.
 *
 * Light DOM.
 *
 * API:
 *   .items      = [{ id, label, hint?, keywords?, group? }]
 *   .open()     — show
 *   .close()    — hide
 *   .isOpen     — getter
 *
 * Attributes:
 *   open         — (boolean, reflected)
 *   placeholder  — input placeholder (default "Search…")
 *
 * Events:
 *   select → CustomEvent<{ id: string; item: PaletteItem }>
 */
export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  keywords?: readonly string[];
  group?: string;
  onSelect?: () => void;
}

export class AtlasCommandPalette extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['open', 'placeholder'];
  }

  private _items: readonly PaletteItem[] = [];
  private _built = false;
  private _dialog: HTMLDialogElement | null = null;
  private _input: HTMLInputElement | null = null;
  private _list: HTMLElement | null = null;
  private _activeIndex = 0;
  private _filtered: PaletteItem[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._syncOpenAttr();
    this._syncPlaceholder();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'open') this._syncOpenAttr();
    if (name === 'placeholder') this._syncPlaceholder();
  }

  get items(): readonly PaletteItem[] {
    return this._items;
  }
  set items(next: readonly PaletteItem[]) {
    this._items = next;
    if (this._built) this._filterAndRender(this._input?.value ?? '');
  }

  get isOpen(): boolean {
    return this._dialog?.open ?? false;
  }

  open(): void {
    if (!this._dialog) return;
    if (!this._dialog.open) {
      this._dialog.showModal();
      if (!this.hasAttribute('open')) this.setAttribute('open', '');
      if (this._input) {
        this._input.value = '';
        this._input.focus();
      }
      this._filterAndRender('');
      this.dispatchEvent(new CustomEvent('open', { bubbles: true, composed: true }));
    }
  }

  close(): void {
    if (this._dialog?.open) this._dialog.close();
  }

  private _build(): void {
    this.innerHTML = '';
    const d = document.createElement('dialog');
    d.setAttribute('data-part', 'palette');

    const input = document.createElement('input');
    input.setAttribute('type', 'search');
    input.setAttribute('data-part', 'input');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-label', 'Command palette search');
    input.setAttribute('placeholder', this.getAttribute('placeholder') ?? 'Search…');

    const list = document.createElement('div');
    list.setAttribute('data-part', 'list');
    list.setAttribute('role', 'listbox');

    d.appendChild(input);
    d.appendChild(list);
    this.appendChild(d);

    this._dialog = d;
    this._input = input;
    this._list = list;

    input.addEventListener('input', () => this._filterAndRender(input.value));
    input.addEventListener('keydown', (ev) => this._onKey(ev));
    list.addEventListener('click', (ev) => {
      const btn = (ev.target as Element)?.closest('[data-palette-item]') as
        | HTMLElement
        | null;
      if (!btn) return;
      const idx = Number(btn.dataset['index']);
      this._commit(idx);
    });
    d.addEventListener('close', () => {
      if (this.hasAttribute('open')) this.removeAttribute('open');
      this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    });
    d.addEventListener('click', (ev) => {
      if (ev.target === d) d.close();
    });

    this._built = true;
  }

  private _syncOpenAttr(): void {
    if (!this._dialog) return;
    const want = this.hasAttribute('open');
    if (want && !this._dialog.open) this.open();
    else if (!want && this._dialog.open) this.close();
  }

  private _syncPlaceholder(): void {
    if (!this._input) return;
    this._input.setAttribute('placeholder', this.getAttribute('placeholder') ?? 'Search…');
  }

  private _match(item: PaletteItem, q: string): boolean {
    if (!q) return true;
    const needle = q.toLowerCase();
    if (item.label.toLowerCase().includes(needle)) return true;
    if (item.hint?.toLowerCase().includes(needle)) return true;
    if (item.keywords) {
      for (const k of item.keywords) if (k.toLowerCase().includes(needle)) return true;
    }
    return false;
  }

  private _filterAndRender(q: string): void {
    this._filtered = this._items.filter((i) => this._match(i, q));
    this._activeIndex = 0;
    this._render();
  }

  private _render(): void {
    if (!this._list) return;
    if (this._filtered.length === 0) {
      this._list.innerHTML = `<div data-part="empty">No matches</div>`;
      return;
    }
    const groups = new Map<string, PaletteItem[]>();
    for (const i of this._filtered) {
      const g = i.group ?? '';
      const list = groups.get(g) ?? [];
      list.push(i);
      groups.set(g, list);
    }

    const parts: string[] = [];
    let flatIdx = 0;
    for (const [group, items] of groups) {
      if (group) {
        parts.push(
          `<div data-part="group-heading">${this._escape(group)}</div>`,
        );
      }
      for (const item of items) {
        const active = flatIdx === this._activeIndex;
        parts.push(
          `<button type="button" role="option" data-palette-item data-index="${flatIdx}" aria-selected="${active ? 'true' : 'false'}">` +
            `<span data-part="label">${this._escape(item.label)}</span>` +
            (item.hint ? `<span data-part="hint">${this._escape(item.hint)}</span>` : '') +
            `</button>`,
        );
        flatIdx++;
      }
    }
    this._list.innerHTML = parts.join('');
    this._scrollActiveIntoView();
  }

  private _scrollActiveIntoView(): void {
    const active = this._list?.querySelector(
      '[data-palette-item][aria-selected="true"]',
    ) as HTMLElement | null;
    active?.scrollIntoView({ block: 'nearest' });
  }

  private _onKey(ev: KeyboardEvent): void {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (this._filtered.length === 0) return;
      this._activeIndex = (this._activeIndex + 1) % this._filtered.length;
      this._syncActive();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (this._filtered.length === 0) return;
      this._activeIndex =
        (this._activeIndex - 1 + this._filtered.length) % this._filtered.length;
      this._syncActive();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      this._commit(this._activeIndex);
    }
  }

  private _syncActive(): void {
    if (!this._list) return;
    const buttons = this._list.querySelectorAll<HTMLElement>('[data-palette-item]');
    buttons.forEach((btn, i) => {
      const active = i === this._activeIndex;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    this._scrollActiveIntoView();
  }

  private _commit(idx: number): void {
    const item = this._filtered[idx];
    if (!item) return;
    item.onSelect?.();
    this.dispatchEvent(
      new CustomEvent('select', {
        detail: { id: item.id, item },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  private _escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

AtlasElement.define('atlas-command-palette', AtlasCommandPalette);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-command-palette': AtlasCommandPalette;
  }
}
