import { AtlasElement, html } from '@atlas/core';

/**
 * <atlas-pagination> — page navigation control.
 *
 * Properties:
 *   - page       : 0-based current page
 *   - pageCount  : total pages (>= 1)
 *   - pageSize   : rows per page
 *   - pageSizeOptions : number[] for the size dropdown (optional)
 *
 * Events:
 *   - page-change      { detail: { page } }
 *   - page-size-change { detail: { pageSize } }
 */
class AtlasPagination extends AtlasElement {
  _page: number = 0;
  _pageCount: number = 1;
  _pageSize: number = 25;
  _pageSizeOptions: number[] = [10, 25, 50, 100];

  // ── Properties ───────────────────────────────────────────────

  get page(): number { return this._page; }
  set page(n: number) {
    const next = clampInt(n, 0, Math.max(0, this._pageCount - 1));
    if (next === this._page) return;
    this._page = next;
    this._update();
  }

  get pageCount(): number { return this._pageCount; }
  set pageCount(n: number) {
    const next = clampInt(n, 1, Number.MAX_SAFE_INTEGER);
    if (next === this._pageCount) return;
    this._pageCount = next;
    if (this._page > next - 1) this._page = next - 1;
    this._update();
  }

  get pageSize(): number { return this._pageSize; }
  set pageSize(n: number) {
    const next = clampInt(n, 1, Number.MAX_SAFE_INTEGER);
    if (next === this._pageSize) return;
    this._pageSize = next;
    this._update();
  }

  get pageSizeOptions(): number[] { return this._pageSizeOptions.slice(); }
  set pageSizeOptions(opts: number[]) {
    if (!Array.isArray(opts)) return;
    this._pageSizeOptions = opts.map((n) => clampInt(n, 1, Number.MAX_SAFE_INTEGER));
    this._update();
  }

  // ── Lifecycle ────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    this._update();
  }

  _update(): void {
    const canPrev = this._page > 0;
    const canNext = this._page < this._pageCount - 1;
    const name = this.getAttribute('name') ?? '';

    const options = this._pageSizeOptions.map((opt) => {
      const option = document.createElement('option');
      option.value = String(opt);
      option.textContent = String(opt);
      if (opt === this._pageSize) option.selected = true;
      return option;
    });

    const frag = html`
      <atlas-button
        variant="ghost" size="sm"
        name="${name ? `${name}-first` : ''}"
        aria-label="First page"
        @click=${() => this._goto(0)}
      >«</atlas-button>
      <atlas-button
        variant="ghost" size="sm"
        name="${name ? `${name}-prev` : ''}"
        aria-label="Previous page"
        @click=${() => this._goto(this._page - 1)}
      >‹</atlas-button>
      <span data-role="page-info" aria-live="polite">
        Page ${this._page + 1} of ${this._pageCount}
      </span>
      <atlas-button
        variant="ghost" size="sm"
        name="${name ? `${name}-next` : ''}"
        aria-label="Next page"
        @click=${() => this._goto(this._page + 1)}
      >›</atlas-button>
      <atlas-button
        variant="ghost" size="sm"
        name="${name ? `${name}-last` : ''}"
        aria-label="Last page"
        @click=${() => this._goto(this._pageCount - 1)}
      >»</atlas-button>
      <label data-role="page-size-label">
        Rows per page
        <select
          @change=${(e: Event) => this._onSizeChange(e)}
          aria-label="Rows per page"
        >${options}</select>
      </label>
    `;

    this.textContent = '';
    this.appendChild(frag);
    this._syncDisabled(canPrev, canNext);
  }

  _syncDisabled(canPrev: boolean, canNext: boolean): void {
    const buttons = this.querySelectorAll('atlas-button');
    const [first, prev, , next, last] = buttons;
    if (first) setBoolAttr(first, 'disabled', !canPrev);
    if (prev) setBoolAttr(prev, 'disabled', !canPrev);
    if (next) setBoolAttr(next, 'disabled', !canNext);
    if (last) setBoolAttr(last, 'disabled', !canNext);
  }

  _goto(n: number): void {
    const next = clampInt(n, 0, Math.max(0, this._pageCount - 1));
    if (next === this._page) return;
    this._page = next;
    this._update();
    this.dispatchEvent(new CustomEvent('page-change', {
      bubbles: true, detail: { page: this._page },
    }));
  }

  _onSizeChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const next = clampInt(Number(target?.value), 1, Number.MAX_SAFE_INTEGER);
    if (next === this._pageSize) return;
    this._pageSize = next;
    this.dispatchEvent(new CustomEvent('page-size-change', {
      bubbles: true, detail: { pageSize: this._pageSize },
    }));
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function setBoolAttr(el: Element, attr: string, on: boolean): void {
  if (on) el.setAttribute(attr, '');
  else el.removeAttribute(attr);
}

AtlasElement.define('atlas-pagination', AtlasPagination);
