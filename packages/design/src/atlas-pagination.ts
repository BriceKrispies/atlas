import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText } from './util.ts';

/**
 * <atlas-pagination> — page-nav control with Prev / pages (with
 * ellipsis) / Next.
 *
 * The element does NOT slice data — it only emits a `change` event with
 * `{ page }` so the surface owns the data model.
 *
 * Attributes:
 *   total      — total item count (defaults to 0)
 *   page       — 1-based current page
 *   page-size  — items per page (defaults to 10)
 *   label      — accessible name on the wrapping nav (defaults to "Pagination")
 *
 * Events:
 *   change → CustomEvent<{ page: number }>
 *
 * Keyboard (when focus is anywhere inside the control):
 *   ArrowLeft / ArrowRight — previous / next page (no wrap)
 *   Home / End             — jump to first / last page
 *
 * Responsive: at narrow viewports (<=480px) the page-number list is
 * replaced by a single "Page X of Y" caption flanked by Prev / Next.
 *
 * Ellipsis algorithm — `_buildWindow(current, last)` decides which page
 * numbers to show with at most one gap on each side:
 *   1) If last <= 7, show all pages [1..last] (no ellipsis).
 *   2) Otherwise, always show first (1) and last (N).
 *   3) Around `current`, show `current-1, current, current+1`.
 *      Clamp the window so it never escapes [2, N-1].
 *   4) If the gap between 1 and the window's start > 1, insert "…".
 *      Same on the trailing side. The result is something like
 *      "1 … 4 5 6 … 20".
 *   5) Edge cases: when `current` is near the start, the leading ellipsis
 *      collapses (window already touches 1), giving "1 2 3 4 … 20"; near
 *      the end, the trailing ellipsis collapses, giving "1 … 17 18 19 20".
 */

const sheet = createSheet(`
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--atlas-space-xs);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text);
    flex-wrap: wrap;
  }
  ol {
    display: flex;
    align-items: center;
    gap: 2px;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li { display: inline-flex; }
  button, .gap, .summary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--atlas-touch-target-min, 44px);
    min-height: var(--atlas-touch-target-min, 44px);
    padding: 0 var(--atlas-space-sm);
    border: 1px solid transparent;
    border-radius: var(--atlas-radius-sm);
    background: transparent;
    color: var(--atlas-color-text);
    font-family: inherit;
    font-size: inherit;
    line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast),
                border-color var(--atlas-transition-fast),
                color var(--atlas-transition-fast);
  }
  button:hover:not([disabled]):not([aria-current]) {
    background: var(--atlas-color-surface);
    border-color: var(--atlas-color-border);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  button[aria-current="page"] {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse, #fff);
    font-weight: var(--atlas-font-weight-medium);
  }
  button[disabled] {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .gap, .summary {
    cursor: default;
    color: var(--atlas-color-text-muted);
  }
  /* The mobile summary replaces the page list at narrow widths. */
  .pages, .summary { display: none; }
  :host([data-mode="full"]) .pages    { display: inline-flex; }
  :host([data-mode="compact"]) .summary { display: inline-flex; }
`);

export interface AtlasPaginationChangeDetail {
  page: number;
}

export class AtlasPagination extends AtlasElement {
  declare total: string;
  declare page: string;
  declare label: string;

  static {
    Object.defineProperty(this.prototype, 'total', AtlasElement.strAttr('total', '0'));
    Object.defineProperty(this.prototype, 'page', AtlasElement.strAttr('page', '1'));
    Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', 'Pagination'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['total', 'page', 'page-size', 'label'];
  }

  private _built = false;
  private _prev: HTMLButtonElement | null = null;
  private _next: HTMLButtonElement | null = null;
  private _list: HTMLOListElement | null = null;
  private _summary: HTMLSpanElement | null = null;
  private _mql: MediaQueryList | null = null;
  private _onMqlChange: (() => void) | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'navigation');
    if (!this._built) this._buildShell();
    this._syncAll();
    // Mobile summary mode: ≤480px collapses page list. We listen via
    // matchMedia rather than measuring at render-time. ResizeObserver
    // would observe the host's own size; viewport width is the right
    // signal here per the spec ("narrow viewport").
    if (typeof window !== 'undefined' && window.matchMedia) {
      this._mql = window.matchMedia('(max-width: 480px)');
      this._onMqlChange = (): void => this._syncMode();
      this._mql.addEventListener('change', this._onMqlChange);
    }
    this._syncMode();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._mql && this._onMqlChange) {
      this._mql.removeEventListener('change', this._onMqlChange);
    }
    this._mql = null;
    this._onMqlChange = null;
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'label') {
      this._syncAriaLabel();
      return;
    }
    this._syncAll();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.dataset['part'] = 'prev';
    prev.setAttribute('aria-label', 'Previous page');
    prev.textContent = '‹ Prev';
    prev.addEventListener('click', () => this._goto(this._currentPage() - 1));

    const list = document.createElement('ol');
    list.className = 'pages';

    const summary = document.createElement('span');
    summary.className = 'summary';

    const next = document.createElement('button');
    next.type = 'button';
    next.dataset['part'] = 'next';
    next.setAttribute('aria-label', 'Next page');
    next.textContent = 'Next ›';
    next.addEventListener('click', () => this._goto(this._currentPage() + 1));

    root.appendChild(prev);
    root.appendChild(list);
    root.appendChild(summary);
    root.appendChild(next);

    this._prev = prev;
    this._list = list;
    this._summary = summary;
    this._next = next;

    this.addEventListener('keydown', (ev) => this._onKey(ev));
    this._built = true;
  }

  private _readNumber(name: string, fallback: number): number {
    const raw = this.getAttribute(name);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return n;
  }

  private _pageSize(): number {
    return Math.max(1, Math.floor(this._readNumber('page-size', 10)));
  }

  private _lastPage(): number {
    const total = Math.max(0, Math.floor(this._readNumber('total', 0)));
    if (total === 0) return 1;
    return Math.max(1, Math.ceil(total / this._pageSize()));
  }

  private _currentPage(): number {
    const last = this._lastPage();
    const p = Math.floor(this._readNumber('page', 1));
    return Math.max(1, Math.min(last, p));
  }

  private _syncAll(): void {
    this._syncAriaLabel();
    this._renderPages();
    this._syncDisabled();
    this._renderSummary();
  }

  private _syncAriaLabel(): void {
    const label = this.getAttribute('label') ?? 'Pagination';
    this.setAttribute('aria-label', label);
  }

  private _syncDisabled(): void {
    const cur = this._currentPage();
    const last = this._lastPage();
    if (this._prev) this._prev.disabled = cur <= 1;
    if (this._next) this._next.disabled = cur >= last;
  }

  /**
   * Compute the page window. Returns an array of `number | 'gap'`:
   *   [1, 'gap', 4, 5, 6, 'gap', 20]
   */
  private _buildWindow(current: number, last: number): Array<number | 'gap'> {
    if (last <= 7) {
      const all: number[] = [];
      for (let i = 1; i <= last; i++) all.push(i);
      return all;
    }
    const items: Array<number | 'gap'> = [];
    items.push(1);

    // Centre window of three around `current`, clamped to [2, last-1].
    let windowStart = Math.max(2, current - 1);
    let windowEnd = Math.min(last - 1, current + 1);
    // If the window is squeezed against an edge, expand outward to keep
    // a 3-wide window (so near-the-end stays "… 17 18 19 20" rather
    // than "… 18 19 20").
    if (current <= 3) {
      windowStart = 2;
      windowEnd = Math.min(last - 1, 4);
    } else if (current >= last - 2) {
      windowEnd = last - 1;
      windowStart = Math.max(2, last - 3);
    }

    if (windowStart > 2) items.push('gap');
    for (let i = windowStart; i <= windowEnd; i++) items.push(i);
    if (windowEnd < last - 1) items.push('gap');

    items.push(last);
    return items;
  }

  private _renderPages(): void {
    if (!this._list) return;
    const cur = this._currentPage();
    const last = this._lastPage();
    const items = this._buildWindow(cur, last);
    this._list.innerHTML = items
      .map((item) => {
        if (item === 'gap') {
          return `<li><span class="gap" aria-hidden="true">…</span></li>`;
        }
        const isCur = item === cur;
        const aria = isCur ? ' aria-current="page"' : '';
        const aLabel = `Page ${item}`;
        return `<li><button type="button" data-page="${escapeAttr(String(item))}" aria-label="${escapeAttr(
          aLabel,
        )}"${aria}>${escapeText(String(item))}</button></li>`;
      })
      .join('');
    // Wire each numeric button.
    const buttons = this._list.querySelectorAll<HTMLButtonElement>('button[data-page]');
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const target = Number(btn.dataset['page']);
        if (Number.isFinite(target)) this._goto(target);
      });
    }
  }

  private _renderSummary(): void {
    if (!this._summary) return;
    const cur = this._currentPage();
    const last = this._lastPage();
    this._summary.textContent = `Page ${cur} of ${last}`;
  }

  private _syncMode(): void {
    const compact = !!this._mql?.matches;
    this.dataset['mode'] = compact ? 'compact' : 'full';
  }

  private _onKey(ev: KeyboardEvent): void {
    let target = -1;
    const cur = this._currentPage();
    const last = this._lastPage();
    switch (ev.key) {
      case 'ArrowRight': target = Math.min(last, cur + 1); break;
      case 'ArrowLeft':  target = Math.max(1, cur - 1); break;
      case 'Home':       target = 1; break;
      case 'End':        target = last; break;
      default: return;
    }
    ev.preventDefault();
    if (target !== cur) this._goto(target);
  }

  private _goto(page: number): void {
    const last = this._lastPage();
    const next = Math.max(1, Math.min(last, Math.floor(page)));
    if (next === this._currentPage()) return;
    this.setAttribute('page', String(next));
    this.dispatchEvent(
      new CustomEvent<AtlasPaginationChangeDetail>('change', {
        detail: { page: next },
        bubbles: true,
        composed: true,
      }),
    );
    const elName = this.getAttribute('name');
    if (elName && this.surfaceId) this.emit(`${this.surfaceId}.${elName}-changed`, { page: next });
  }
}

AtlasElement.define('atlas-pagination', AtlasPagination);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-pagination': AtlasPagination;
  }
}
