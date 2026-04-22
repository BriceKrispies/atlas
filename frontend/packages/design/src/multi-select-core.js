/**
 * MultiSelectCore — pure state machine for <atlas-multi-select>.
 *
 * Hexagonal core: no DOM, no events, no timers. Holds the selection/query/
 * lifecycle state, exposes actions, and notifies subscribers of changes.
 * The web component is the adapter that renders state and maps user input
 * to action calls.
 *
 * ── Ports ────────────────────────────────────────────────────────────
 *   OptionsSource: { load(query?: string): Promise<Option[]> }
 *     Optional. When supplied, `loadOptions()` drives the lifecycle.
 *     The core tolerates:
 *       - resolved empty array   → status "empty"
 *       - resolved non-array     → treated as empty, warning suppressed
 *       - resolved null/undefined → treated as empty
 *       - thrown / rejected      → status "error", error message captured
 *     Re-entrant calls cancel the previous load's effect via a monotonic
 *     token; late resolves are ignored. This means a surface can call
 *     loadOptions() on every keystroke without stale data racing in.
 *
 * ── State shape ──────────────────────────────────────────────────────
 *   status:      "idle" | "loading" | "ready" | "empty" | "error"
 *   options:     Option[]                       (always an array)
 *   selected:    string[]                       (values, insertion order)
 *   query:       string
 *   open:        boolean
 *   activeIndex: number                         (index into visibleOptions)
 *   error:       string | null
 *
 * ── Options ──────────────────────────────────────────────────────────
 *   { value: string, label: string, disabled?: boolean }
 *
 * ── Config ───────────────────────────────────────────────────────────
 *   max:           number | null       cap selections; null = unlimited
 *   allowCreate:   boolean             allow creating options from query
 *   closeOnSelect: boolean             close after each pick
 *   disabled:      boolean             reject all mutations
 *   optionsSource: OptionsSource | null
 *
 * ── Action contract ──────────────────────────────────────────────────
 * Every mutating action returns the same shape:
 *   { changed: boolean, added: string[], removed: string[] }
 * so the adapter can dispatch change events with an accurate delta
 * without diffing state itself.
 */

/**
 * @typedef {{value: string, label: string, disabled?: boolean}} Option
 * @typedef {{load: (query?: string) => Promise<Option[] | null | undefined>}} OptionsSource
 * @typedef {"idle"|"loading"|"ready"|"empty"|"error"} Status
 */

export const LIFECYCLE = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  EMPTY: 'empty',
  ERROR: 'error',
});

const NO_DELTA = Object.freeze({ changed: false, added: [], removed: [] });

export class MultiSelectCore {
  /**
   * @param {{
   *   options?: Option[],
   *   selected?: string[],
   *   max?: number | null,
   *   allowCreate?: boolean,
   *   closeOnSelect?: boolean,
   *   disabled?: boolean,
   *   optionsSource?: OptionsSource | null,
   * }} [config]
   */
  constructor(config = {}) {
    /** @type {Option[]} */
    this._options = normalizeOptions(config.options);
    /** @type {string[]} */
    this._selected = Array.isArray(config.selected)
      ? config.selected.map(String).filter((v) => this._options.some((o) => o.value === v))
      : [];
    this._query = '';
    this._open = false;
    this._activeIndex = -1;
    /** @type {Status} */
    this._status = this._options.length > 0
      ? LIFECYCLE.READY
      : (config.optionsSource ? LIFECYCLE.IDLE : LIFECYCLE.EMPTY);
    /** @type {string | null} */
    this._error = null;

    this.max = normalizeMax(config.max);
    this.allowCreate = !!config.allowCreate;
    this.closeOnSelect = !!config.closeOnSelect;
    this.disabled = !!config.disabled;

    /** @type {OptionsSource | null} */
    this._source = config.optionsSource ?? null;
    this._loadToken = 0;

    /** @type {Set<(state: ReturnType<MultiSelectCore['getState']>) => void>} */
    this._listeners = new Set();
  }

  // ── Observability ───────────────────────────────────────────────

  getState() {
    return {
      status: this._status,
      options: this._options,
      selected: this._selected.slice(),
      query: this._query,
      open: this._open,
      activeIndex: this._activeIndex,
      error: this._error,
    };
  }

  /** @param {(state: ReturnType<MultiSelectCore['getState']>) => void} listener */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  _notify() {
    const state = this.getState();
    for (const fn of this._listeners) {
      try { fn(state); } catch { /* listener errors don't corrupt the core */ }
    }
  }

  // ── Selectors (pure reads) ──────────────────────────────────────

  /** Options filtered by current query and sorted alphabetically. */
  visibleOptions() {
    const q = this._query.trim().toLowerCase();
    const matches = q
      ? this._options.filter((o) => o.label.toLowerCase().includes(q))
      : this._options.slice();
    return matches.sort(labelCmp);
  }

  /** Currently selected option objects, sorted alphabetically. */
  selectedOptions() {
    const sel = new Set(this._selected);
    return this._options.filter((o) => sel.has(o.value)).slice().sort(labelCmp);
  }

  /** Whether a value *could* be selected right now (respects max, disabled). */
  canSelect(value) {
    if (this.disabled) return false;
    if (this._selected.includes(value)) return false;
    const opt = this._options.find((o) => o.value === value);
    if (!opt || opt.disabled) return false;
    if (this.max != null && this._selected.length >= this.max) return false;
    return true;
  }

  /** Whether the current query would produce a new option via createFromQuery. */
  canCreate() {
    if (!this.allowCreate || this.disabled) return false;
    const q = this._query.trim();
    if (!q) return false;
    return !this._options.some((o) => o.label.toLowerCase() === q.toLowerCase());
  }

  // ── Actions (mutators — all return a delta) ─────────────────────

  setOptions(options) {
    this._options = normalizeOptions(options);
    // Drop any selected values that no longer exist in the option set.
    const valid = new Set(this._options.map((o) => o.value));
    const before = this._selected;
    const after = before.filter((v) => valid.has(v));
    const removed = before.filter((v) => !valid.has(v));
    this._selected = after;

    this._status = this._options.length > 0 ? LIFECYCLE.READY : LIFECYCLE.EMPTY;
    this._error = null;
    this._clampActive();
    this._notify();
    return { changed: removed.length > 0, added: [], removed };
  }

  setQuery(query) {
    const q = String(query ?? '');
    if (q === this._query) return NO_DELTA;
    this._query = q;
    this._activeIndex = this.visibleOptions().length > 0 ? 0 : -1;
    this._notify();
    return NO_DELTA;
  }

  select(value) {
    const v = String(value);
    if (!this.canSelect(v)) return NO_DELTA;
    this._selected = [...this._selected, v];
    if (this.closeOnSelect) this._open = false;
    this._notify();
    return { changed: true, added: [v], removed: [] };
  }

  unselect(value) {
    const v = String(value);
    if (this.disabled) return NO_DELTA;
    const idx = this._selected.indexOf(v);
    if (idx < 0) return NO_DELTA;
    this._selected = this._selected.filter((x) => x !== v);
    this._notify();
    return { changed: true, added: [], removed: [v] };
  }

  toggle(value) {
    return this._selected.includes(String(value))
      ? this.unselect(value)
      : this.select(value);
  }

  /** Remove the most recently selected value (e.g. Backspace on empty query). */
  unselectLast() {
    if (this._selected.length === 0) return NO_DELTA;
    return this.unselect(this._selected[this._selected.length - 1]);
  }

  clear() {
    if (this._selected.length === 0) return NO_DELTA;
    const removed = this._selected.slice();
    this._selected = [];
    this._notify();
    return { changed: true, added: [], removed };
  }

  openListbox() {
    if (this._open || this.disabled) return NO_DELTA;
    this._open = true;
    if (this._activeIndex < 0 && this.visibleOptions().length > 0) {
      this._activeIndex = 0;
    }
    this._notify();
    return NO_DELTA;
  }

  closeListbox() {
    if (!this._open) return NO_DELTA;
    this._open = false;
    this._activeIndex = -1;
    this._notify();
    return NO_DELTA;
  }

  /** Move the active (keyboard-highlighted) option. Clamped, not wrapping. */
  moveActive(delta) {
    const n = this.visibleOptions().length;
    if (n === 0) { this._activeIndex = -1; return NO_DELTA; }
    const base = this._activeIndex < 0 ? 0 : this._activeIndex;
    this._activeIndex = clamp(base + delta, 0, n - 1);
    this._notify();
    return NO_DELTA;
  }

  setActive(index) {
    const n = this.visibleOptions().length;
    if (n === 0) { this._activeIndex = -1; }
    else this._activeIndex = clamp(index, 0, n - 1);
    this._notify();
    return NO_DELTA;
  }

  /** Toggle the currently-active option, if any. */
  toggleActive() {
    const list = this.visibleOptions();
    if (this._activeIndex < 0 || this._activeIndex >= list.length) return NO_DELTA;
    return this.toggle(list[this._activeIndex].value);
  }

  /**
   * If allowCreate is on and the query doesn't match an existing label,
   * add a new option with value=label=query and select it.
   */
  createFromQuery() {
    if (!this.canCreate()) return NO_DELTA;
    const q = this._query.trim();
    const opt = { value: q, label: q, disabled: false };
    this._options = [...this._options, opt];
    this._status = LIFECYCLE.READY;
    this._error = null;
    const delta = this.select(q);
    this._query = '';
    this._notify();
    return delta;
  }

  // ── Port-driven loading ─────────────────────────────────────────

  /**
   * Drive the lifecycle from the configured OptionsSource.
   * - No port configured → no-op (status unchanged).
   * - Resolves with array → status ready (or empty).
   * - Resolves with null/undefined/non-array → treated as empty (defensive).
   * - Rejects/throws → status error with the message.
   *
   * Returns a Promise<Status> that resolves with the terminal status.
   * Safe to call concurrently; late resolutions are discarded.
   *
   * @param {string} [query]
   */
  async loadOptions(query) {
    if (!this._source) return this._status;
    const token = ++this._loadToken;
    this._status = LIFECYCLE.LOADING;
    this._error = null;
    this._notify();

    try {
      const result = await this._source.load(query);
      if (token !== this._loadToken) return this._status; // superseded
      const opts = Array.isArray(result) ? result : [];
      this.setOptions(opts);
      // setOptions picks ready/empty based on length — keep that.
      return this._status;
    } catch (err) {
      if (token !== this._loadToken) return this._status; // superseded
      this._status = LIFECYCLE.ERROR;
      this._error = err instanceof Error ? err.message : String(err ?? 'Unknown error');
      this._notify();
      return this._status;
    }
  }

  setOptionsSource(source) {
    this._source = source ?? null;
    if (!this._source && this._status === LIFECYCLE.LOADING) {
      // Port yanked mid-flight — synthesize a terminal state.
      this._status = this._options.length > 0 ? LIFECYCLE.READY : LIFECYCLE.EMPTY;
      this._notify();
    }
  }

  _clampActive() {
    const n = this.visibleOptions().length;
    if (n === 0) this._activeIndex = -1;
    else if (this._activeIndex >= n) this._activeIndex = n - 1;
  }
}

// ── helpers ───────────────────────────────────────────────────────

function normalizeOptions(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (item == null) continue;
    const value = String(
      typeof item === 'object' ? (item.value ?? item.id ?? item.label ?? item.text) : item,
    );
    if (!value || seen.has(value)) continue;
    const label = String(
      typeof item === 'object' ? (item.label ?? item.text ?? item.value ?? value) : item,
    );
    const disabled = typeof item === 'object' ? !!item.disabled : false;
    seen.add(value);
    out.push({ value, label, disabled });
  }
  return out;
}

function normalizeMax(m) {
  if (m == null || m === '' || m === false) return null;
  const n = Number(m);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function labelCmp(a, b) {
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}
