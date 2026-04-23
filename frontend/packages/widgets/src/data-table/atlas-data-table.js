import { AtlasElement } from '@atlas/core';
import { DataTableCore, STATUS } from './data-table-core.js';
import { arrayDataSource } from '../data-source/array-data-source.js';
import { formatCell } from './cell-formatters.js';

/**
 * <atlas-data-table> — paginated, sortable, filterable data table with
 * optional SSE-driven streaming row updates.
 *
 * Adapter pattern: the element delegates all rules to `DataTableCore`.
 * Rendering is surgical — a stable shell is built once, then the toolbar,
 * body, pagination, and live-region are updated in place whenever the
 * core's state changes.
 *
 * ── Attributes / properties ──────────────────────────────────────
 *   name                  : testid source (AtlasElement convention)
 *   label                 : accessible name on <atlas-table>
 *   row-key   / rowKey    : field name or function (default: 'id')
 *   page-size / pageSize  : integer; 0 disables pagination (default 25)
 *   selection / selectionMode : 'none' | 'single' | 'multi'
 *   density               : 'compact' | 'cozy' | 'comfortable'
 *   resource-type         : when set + dataSource.subscribe exists, wires
 *                           the SSE patch stream to the core
 *   empty-heading / empty-body : customize the empty state
 *   columns (property)    : Array<ColumnConfig>
 *   data (property)       : Array<Row> or DataSource (duck-typed on fetchAll)
 *   dataSource (property) : explicit DataSource property alternative to `data`
 *
 * ── Events (bubbling) ────────────────────────────────────────────
 *   row-selected     { rowKey, row }
 *   row-unselected   { rowKey }
 *   row-activated    { rowKey, row }     // Enter / double-click
 *   sort-change      { columnKey, direction }
 *   filter-change    { columnKey, value }
 *   filter-cleared   {}
 *   page-change      { page, pageSize }
 *   stream-patch-applied { type, rowKey }
 *
 * ── States (`data-state` attribute, per C4) ─────────────────────
 *   loading | empty | filtered-empty | error | success | unauthorized
 */
class AtlasDataTable extends AtlasElement {
  static get observedAttributes() {
    return [
      'page-size',
      'selection',
      'density',
      'resource-type',
      'empty-heading',
      'empty-body',
      'label',
      'row-key',
    ];
  }

  constructor() {
    super();
    this._core = new DataTableCore({});
    this._columns = [];
    /** @type {import('../data-source/types.js').DataSource | null} */
    this._dataSource = null;
    this._unsubCore = null;
    this._unsubStream = null;
    this._shellBuilt = false;
    this._liveRegion = null;
    this._lastFetchToken = 0;
  }

  // ── Property API ─────────────────────────────────────────────

  get columns() { return this._columns; }
  set columns(next) {
    this._columns = Array.isArray(next) ? next.slice() : [];
    this._core.setColumns(this._columns);
    if (this._shellBuilt) this._rebuildShell();
  }

  get rowKey() { return this._core._rowKey; }
  set rowKey(next) {
    this._core._rowKey = next ?? 'id';
  }

  get pageSize() { return this._core._pageSize; }
  set pageSize(next) {
    this._core.setPageSize(next);
  }

  get selectionMode() { return this._core._selectionMode; }
  set selectionMode(next) {
    this._core.setSelectionMode(next);
  }

  get selection() { return [...this._core.getState().selection]; }

  get state() { return this._core.getState(); }

  /** Accepts an array, a DataSource, or a Promise resolving to rows. */
  get data() { return this._core.getState().rows; }
  set data(next) {
    this._installDataInput(next);
  }

  get dataSource() { return this._dataSource; }
  set dataSource(src) {
    this._installDataInput(src);
  }

  /** Force a re-fetch from the current DataSource. */
  async reload() {
    if (!this._dataSource) return;
    await this._runFetch();
  }

  // ── Lifecycle ────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('data-widget', 'atlas-data-table');
    this._applyAttributes();
    this._core.setColumns(this._columns);
    this._unsubCore = this._core.subscribe(() => this._update());
    this._buildShell();
    // If a DataSource is already attached (e.g. set before connect), kick off fetch.
    if (this._dataSource) this._runFetch();
    else this._update();
  }

  disconnectedCallback() {
    this._unsubCore?.();
    this._unsubCore = null;
    this._unsubStream?.();
    this._unsubStream = null;
    super.disconnectedCallback?.();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    this._applyAttribute(name, newVal);
  }

  _applyAttributes() {
    for (const attr of AtlasDataTable.observedAttributes) {
      if (this.hasAttribute(attr)) this._applyAttribute(attr, this.getAttribute(attr));
    }
  }

  _applyAttribute(attr, value) {
    switch (attr) {
      case 'page-size':
        this._core.setPageSize(Number(value));
        break;
      case 'selection':
        this._core.setSelectionMode(value === 'multi' || value === 'single' ? value : 'none');
        break;
      case 'density':
        this.dataset.density = value ?? 'cozy';
        break;
      case 'row-key':
        if (value) this._core._rowKey = value;
        break;
      case 'resource-type':
        this._attachStreamSubscription();
        break;
      default:
        if (this._shellBuilt) this._updateHeader();
    }
  }

  // ── Data input ───────────────────────────────────────────────

  _installDataInput(next) {
    this._unsubStream?.();
    this._unsubStream = null;

    if (Array.isArray(next)) {
      this._dataSource = arrayDataSource(next);
    } else if (next && typeof next.fetchAll === 'function') {
      this._dataSource = next;
    } else if (next == null) {
      this._dataSource = null;
      this._core.setAllRows([]);
      return;
    } else {
      this._dataSource = arrayDataSource([]);
    }

    if (this.isConnected) this._runFetch();
    if (this.hasAttribute('resource-type') || this._dataSource?.capabilities?.includes('stream')) {
      this._attachStreamSubscription();
    }
  }

  async _runFetch() {
    if (!this._dataSource) return;
    const token = ++this._lastFetchToken;
    this._core.setLoading();
    try {
      const result = await this._dataSource.fetchAll();
      if (token !== this._lastFetchToken) return; // superseded
      this._core.setAllRows(Array.isArray(result?.rows) ? result.rows : []);
    } catch (err) {
      if (token !== this._lastFetchToken) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load');
      this._core.setError(message);
    }
  }

  _attachStreamSubscription() {
    this._unsubStream?.();
    this._unsubStream = null;
    const ds = this._dataSource;
    if (!ds || typeof ds.subscribe !== 'function') return;

    this._unsubStream = ds.subscribe((patch) => {
      if (!patch || typeof patch !== 'object') return;
      if (patch.type === 'reload') {
        this._runFetch();
        this._emitTelemetry('stream-patch-applied', { type: 'reload' });
        this.dispatchEvent(new CustomEvent('stream-patch-applied', {
          bubbles: true, detail: { type: 'reload' },
        }));
        return;
      }
      const delta = this._core.applyPatch(patch);
      if (delta.changed) {
        const rowKey = patch.type === 'remove' ? patch.rowKey
          : patch.row ? this._core.keyOf(patch.row) : null;
        this._emitTelemetry('stream-patch-applied', { type: patch.type, rowKey });
        this.dispatchEvent(new CustomEvent('stream-patch-applied', {
          bubbles: true, detail: { type: patch.type, rowKey },
        }));
      }
    });
  }

  // ── Shell (built once) ───────────────────────────────────────

  _buildShell() {
    this.textContent = '';

    const live = document.createElement('div');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    live.className = 'atlas-visually-hidden';
    live.dataset.role = 'live-region';
    this._liveRegion = live;
    this.appendChild(live);

    const toolbar = document.createElement('atlas-table-toolbar');
    toolbar.setAttribute('name', this._childName('toolbar'));
    toolbar.addEventListener('filter-input', (e) => this._onFilterInput(e));
    this._toolbar = toolbar;
    this.appendChild(toolbar);

    const body = document.createElement('div');
    body.dataset.role = 'body';
    this._body = body;
    this.appendChild(body);

    const pagination = document.createElement('atlas-pagination');
    pagination.setAttribute('name', this._childName('pagination'));
    pagination.addEventListener('page-change', (e) => this._onPageChange(e));
    pagination.addEventListener('page-size-change', (e) => this._onPageSizeChange(e));
    this._pagination = pagination;
    this.appendChild(pagination);

    this._shellBuilt = true;
    this._renderToolbar();
    this._update();
  }

  _rebuildShell() {
    this._shellBuilt = false;
    this._buildShell();
  }

  _childName(suffix) {
    const myName = this.getAttribute('name');
    return myName ? `${myName}-${suffix}` : suffix;
  }

  // ── Rendering ────────────────────────────────────────────────

  _update() {
    if (!this._shellBuilt) return;
    const state = this._core.getState();
    this.setAttribute('data-state', state.status);

    switch (state.status) {
      case STATUS.IDLE:
      case STATUS.LOADING:
        this._renderLoading();
        break;
      case STATUS.EMPTY:
        this._renderEmpty();
        break;
      case STATUS.FILTERED_EMPTY:
        this._renderFilteredEmpty();
        break;
      case STATUS.ERROR:
        this._renderError(state.error);
        break;
      case STATUS.READY:
      default:
        this._renderSuccess(state);
        break;
    }
    this._updatePagination(state);
  }

  _renderToolbar() {
    const toolbar = this._toolbar;
    if (!toolbar) return;
    toolbar.textContent = '';
    const filterable = this._columns.filter((c) => c?.filter);
    if (filterable.length === 0) {
      toolbar.hidden = true;
      return;
    }
    toolbar.hidden = false;
    const inputs = filterable.map((col) => {
      const wrap = document.createElement('label');
      wrap.dataset.column = String(col.key);

      const input = document.createElement('atlas-input');
      const key = typeof col.key === 'string' ? col.key : '';
      input.setAttribute('name', this._childName(`filter-${key}`));
      input.setAttribute('label', col.filter?.label ?? col.label ?? key);
      input.setAttribute('placeholder', col.filter?.placeholder ?? `Filter ${col.label ?? key}`);
      input.setAttribute('data-column-key', key);
      input.addEventListener('change', (e) => {
        this._core.setFilter(key, /** @type {any} */ (e).detail?.value);
        this._emitTelemetry('filter-applied', { columnKey: key, value: /** @type {any} */ (e).detail?.value });
        this.dispatchEvent(new CustomEvent('filter-change', {
          bubbles: true, detail: { columnKey: key, value: /** @type {any} */ (e).detail?.value },
        }));
      });
      wrap.appendChild(input);
      return wrap;
    });
    for (const el of inputs) toolbar.appendChild(el);
  }

  _renderLoading() {
    this._body.textContent = '';
    const skeleton = document.createElement('atlas-skeleton');
    skeleton.setAttribute('rows', String(Math.max(3, this._core._pageSize || 5)));
    skeleton.setAttribute('name', this._childName('skeleton'));
    this._body.appendChild(skeleton);
    this._pagination.hidden = true;
  }

  _renderEmpty() {
    this._body.textContent = '';
    const heading = this.getAttribute('empty-heading') ?? 'Nothing here yet';
    const body = this.getAttribute('empty-body') ?? '';
    this._body.appendChild(messageBlock('empty', heading, body));
    this._pagination.hidden = true;
  }

  _renderFilteredEmpty() {
    this._body.textContent = '';
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'sm');
    stack.setAttribute('align', 'center');
    stack.setAttribute('padding', 'xl');
    stack.dataset.role = 'filtered-empty';

    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '3');
    heading.textContent = 'No matches';
    stack.appendChild(heading);

    const description = document.createElement('atlas-text');
    description.setAttribute('variant', 'muted');
    description.setAttribute('block', '');
    description.textContent = 'Try adjusting your filters.';
    stack.appendChild(description);

    const clear = document.createElement('atlas-button');
    clear.setAttribute('variant', 'ghost');
    clear.setAttribute('name', this._childName('clear-filters'));
    clear.textContent = 'Clear filters';
    clear.addEventListener('click', () => {
      this._core.clearFilters();
      for (const input of this.querySelectorAll('atlas-input[data-column-key]')) {
        /** @type {any} */ (input).value = '';
        input.setAttribute('value', '');
      }
      this._emitTelemetry('filter-cleared', {});
      this.dispatchEvent(new CustomEvent('filter-cleared', { bubbles: true }));
    });
    stack.appendChild(clear);

    this._body.appendChild(stack);
    this._pagination.hidden = true;
  }

  _renderError(message) {
    this._body.textContent = '';
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'sm');
    stack.setAttribute('padding', 'lg');

    const text = document.createElement('atlas-text');
    text.setAttribute('variant', 'error');
    text.textContent = message ?? 'Something went wrong';
    stack.appendChild(text);

    const retry = document.createElement('atlas-button');
    retry.setAttribute('name', this._childName('retry'));
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => this.reload());
    stack.appendChild(retry);

    this._body.appendChild(stack);
    this._pagination.hidden = true;
  }

  _renderSuccess(state) {
    this._body.textContent = '';

    const table = document.createElement('atlas-table');
    const label = this.getAttribute('label');
    if (label) table.setAttribute('label', label);

    const head = document.createElement('atlas-table-head');
    const headRow = document.createElement('atlas-row');
    for (const col of this._columns) {
      // Use the design-system <atlas-table-cell header> primitive as the
      // header cell — it already participates in the anonymous table box
      // via display: table-cell, and carries the correct padding, border,
      // and typography. Sort affordances are layered on via attributes and
      // listeners; the element stays a plain table cell underneath.
      const cell = document.createElement('atlas-table-cell');
      cell.setAttribute('header', '');
      cell.setAttribute('role', 'columnheader');
      const key = typeof col.key === 'string' ? col.key : '';
      cell.dataset.columnKey = key;
      cell.setAttribute('name', this._childName(`header-${key || 'col'}`));

      const sortDir = (state.sortBy === key && state.sortDir) ? state.sortDir : null;
      if (col.sortable) {
        cell.setAttribute('sortable', '');
        cell.setAttribute('tabindex', '0');
        cell.setAttribute('aria-sort',
          sortDir === 'asc' ? 'ascending' :
          sortDir === 'desc' ? 'descending' : 'none');
        cell.addEventListener('click', () => this._toggleSort(key));
        cell.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this._toggleSort(key);
          }
        });
      }

      const labelNode = document.createElement('span');
      labelNode.textContent = col.label ?? key;
      cell.appendChild(labelNode);

      if (col.sortable) {
        const indicator = document.createElement('span');
        indicator.dataset.role = 'sort-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        cell.appendChild(indicator);
      }

      headRow.appendChild(cell);
    }
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('atlas-table-body');
    const rows = this._core.pageRows();
    const totalRows = this._core.filteredRows().length;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = this._core.keyOf(row);
      const rowEl = document.createElement('atlas-row');
      rowEl.setAttribute('key', String(key));
      rowEl.dataset.rowKey = String(key);
      if (state.selection.has(key)) rowEl.setAttribute('aria-selected', 'true');
      rowEl.setAttribute('aria-rowindex', String(
        state.page * (state.pageSize || totalRows) + i + 1,
      ));

      for (const col of this._columns) {
        const cell = document.createElement('atlas-table-cell');
        if (col.align) cell.dataset.align = col.align;
        const accessor = typeof col.key === 'function'
          ? col.key
          : (r) => /** @type {any} */ (r)[col.key];
        const value = accessor(row);
        const formatted = formatCell(value, row, col);
        if (formatted instanceof Node) cell.appendChild(formatted);
        else if (formatted != null) cell.textContent = String(formatted);
        rowEl.appendChild(cell);
      }

      if (state.selectionMode !== 'none') {
        rowEl.tabIndex = 0;
        rowEl.addEventListener('click', (event) => {
          if (event.target !== rowEl && event.target?.closest('atlas-button,a,input,select')) return;
          this._toggleRowSelection(key, row);
        });
        rowEl.addEventListener('keydown', (event) => this._onRowKey(event, key, row));
      }

      body.appendChild(rowEl);
    }

    table.appendChild(body);
    table.setAttribute('aria-rowcount', String(totalRows));
    this._body.appendChild(table);

    this._pagination.hidden = (this._core._pageSize ?? 0) <= 0;
  }

  _updatePagination(state) {
    const pag = this._pagination;
    if (!pag) return;
    pag.pageCount = this._core.pageCount();
    pag.pageSize = state.pageSize;
    pag.page = state.page;
  }

  _updateHeader() {
    // A label change doesn't require a full rebuild — just patch the table.
    const table = this._body?.querySelector('atlas-table');
    const label = this.getAttribute('label');
    if (table && label) table.setAttribute('label', label);
  }

  // ── Event handlers (DOM → core) ──────────────────────────────

  _toggleSort(columnKey) {
    if (!columnKey) return;
    this._core.setSort(columnKey);
    const s = this._core.getState();
    this._announce(
      s.sortDir
        ? `Sorted by ${columnKey}, ${s.sortDir === 'asc' ? 'ascending' : 'descending'}`
        : 'Sort cleared',
    );
    this._emitTelemetry('sort-changed', { columnKey, direction: s.sortDir });
    this.dispatchEvent(new CustomEvent('sort-change', {
      bubbles: true, detail: { columnKey, direction: s.sortDir },
    }));
  }

  _onFilterInput(_event) { /* placeholder — filter-input handled on atlas-input directly */ }

  _onPageChange(event) {
    const page = Number(event.detail?.page ?? 0);
    this._core.setPage(page);
    const s = this._core.getState();
    this._announce(`Page ${s.page + 1} of ${this._core.pageCount()}`);
    this._emitTelemetry('page-changed', { page: s.page, pageSize: s.pageSize });
    this.dispatchEvent(new CustomEvent('page-change', {
      bubbles: true, detail: { page: s.page, pageSize: s.pageSize },
    }));
  }

  _onPageSizeChange(event) {
    const size = Number(event.detail?.pageSize ?? 25);
    this._core.setPageSize(size);
    this._emitTelemetry('page-size-changed', { pageSize: size });
    this.dispatchEvent(new CustomEvent('page-change', {
      bubbles: true, detail: { page: 0, pageSize: size },
    }));
  }

  _onRowKey(event, key, row) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = [...this.querySelectorAll('atlas-row[data-row-key]')];
      const i = rows.indexOf(event.currentTarget);
      const next = event.key === 'ArrowDown' ? rows[i + 1] : rows[i - 1];
      if (next) /** @type {HTMLElement} */ (next).focus();
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      this._toggleRowSelection(key, row);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this._emitTelemetry('row-activated', { rowKey: key });
      this.dispatchEvent(new CustomEvent('row-activated', {
        bubbles: true, detail: { rowKey: key, row },
      }));
    }
  }

  _toggleRowSelection(key, row) {
    const before = this._core.getState().selection.has(key);
    const delta = this._core.toggleRowSelection(key);
    if (!delta.changed) return;
    const nowSelected = this._core.getState().selection.has(key);
    if (nowSelected) {
      this._emitTelemetry('row-selected', { rowKey: key });
      this.dispatchEvent(new CustomEvent('row-selected', {
        bubbles: true, detail: { rowKey: key, row },
      }));
    } else if (before) {
      this._emitTelemetry('row-unselected', { rowKey: key });
      this.dispatchEvent(new CustomEvent('row-unselected', {
        bubbles: true, detail: { rowKey: key },
      }));
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  _announce(message) {
    if (!this._liveRegion) return;
    this._liveRegion.textContent = message;
  }

  _emitTelemetry(suffix, payload) {
    const sid = this.surfaceId;
    const name = this.getAttribute('name');
    if (!sid || !name) return;
    this.emit(`${sid}.${name}.${suffix}`, payload);
  }
}

function messageBlock(role, heading, body) {
  const stack = document.createElement('atlas-stack');
  stack.setAttribute('gap', 'sm');
  stack.setAttribute('align', 'center');
  stack.setAttribute('padding', 'xl');
  stack.dataset.role = role;

  const h = document.createElement('atlas-heading');
  h.setAttribute('level', '3');
  h.textContent = heading;
  stack.appendChild(h);

  if (body) {
    const p = document.createElement('atlas-text');
    p.setAttribute('variant', 'muted');
    p.setAttribute('block', '');
    p.textContent = body;
    stack.appendChild(p);
  }
  return stack;
}

AtlasElement.define('atlas-data-table', AtlasDataTable);
