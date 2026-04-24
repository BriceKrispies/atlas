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

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface OptionsSource {
  load: (query?: string) => Promise<readonly Option[] | null | undefined>;
}

export type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface CoreState {
  status: Status;
  options: Option[];
  selected: string[];
  query: string;
  open: boolean;
  activeIndex: number;
  error: string | null;
}

export interface Delta {
  changed: boolean;
  added: string[];
  removed: string[];
}

export interface CoreConfig {
  options?: readonly unknown[];
  selected?: readonly string[];
  max?: number | null | undefined;
  allowCreate?: boolean;
  closeOnSelect?: boolean;
  disabled?: boolean;
  optionsSource?: OptionsSource | null;
}

export type Listener = (state: CoreState) => void;

export const LIFECYCLE = Object.freeze({
  IDLE: 'idle' as const,
  LOADING: 'loading' as const,
  READY: 'ready' as const,
  EMPTY: 'empty' as const,
  ERROR: 'error' as const,
});

const NO_DELTA = Object.freeze({
  changed: false,
  added: Object.freeze([]),
  removed: Object.freeze([]),
}) as unknown as Delta;

export class MultiSelectCore {
  private _options: Option[];
  private _selected: string[];
  private _query = '';
  private _open = false;
  private _activeIndex = -1;
  private _status: Status;
  private _error: string | null = null;

  max: number | null;
  allowCreate: boolean;
  closeOnSelect: boolean;
  disabled: boolean;

  private _source: OptionsSource | null;
  private _loadToken = 0;

  private _listeners: Set<Listener> = new Set();

  constructor(config: CoreConfig = {}) {
    this._options = normalizeOptions(config.options);
    this._selected = Array.isArray(config.selected)
      ? config.selected
          .map(String)
          .filter((v) => this._options.some((o) => o.value === v))
      : [];
    this._status =
      this._options.length > 0
        ? LIFECYCLE.READY
        : config.optionsSource
          ? LIFECYCLE.IDLE
          : LIFECYCLE.EMPTY;

    this.max = normalizeMax(config.max);
    this.allowCreate = !!config.allowCreate;
    this.closeOnSelect = !!config.closeOnSelect;
    this.disabled = !!config.disabled;

    this._source = config.optionsSource ?? null;
  }

  // ── Observability ───────────────────────────────────────────────

  getState(): CoreState {
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

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private _notify(): void {
    const state = this.getState();
    for (const fn of this._listeners) {
      try {
        fn(state);
      } catch {
        /* listener errors don't corrupt the core */
      }
    }
  }

  // ── Selectors (pure reads) ──────────────────────────────────────

  /** Options filtered by current query and sorted alphabetically. */
  visibleOptions(): Option[] {
    const q = this._query.trim().toLowerCase();
    const matches = q
      ? this._options.filter((o) => o.label.toLowerCase().includes(q))
      : this._options.slice();
    return matches.sort(labelCmp);
  }

  /** Currently selected option objects, sorted alphabetically. */
  selectedOptions(): Option[] {
    const sel = new Set(this._selected);
    return this._options
      .filter((o) => sel.has(o.value))
      .slice()
      .sort(labelCmp);
  }

  /** Whether a value *could* be selected right now (respects max, disabled). */
  canSelect(value: string): boolean {
    if (this.disabled) return false;
    if (this._selected.includes(value)) return false;
    const opt = this._options.find((o) => o.value === value);
    if (!opt || opt.disabled) return false;
    if (this.max != null && this._selected.length >= this.max) return false;
    return true;
  }

  /** Whether the current query would produce a new option via createFromQuery. */
  canCreate(): boolean {
    if (!this.allowCreate || this.disabled) return false;
    const q = this._query.trim();
    if (!q) return false;
    return !this._options.some(
      (o) => o.label.toLowerCase() === q.toLowerCase(),
    );
  }

  // ── Actions (mutators — all return a delta) ─────────────────────

  setOptions(options: readonly unknown[]): Delta {
    this._options = normalizeOptions(options);
    // Drop any selected values that no longer exist in the option set.
    const valid = new Set(this._options.map((o) => o.value));
    const before = this._selected;
    const after = before.filter((v) => valid.has(v));
    const removed = before.filter((v) => !valid.has(v));
    this._selected = after;

    this._status =
      this._options.length > 0 ? LIFECYCLE.READY : LIFECYCLE.EMPTY;
    this._error = null;
    this._clampActive();
    this._notify();
    return { changed: removed.length > 0, added: [], removed };
  }

  setQuery(query: string): Delta {
    const q = String(query ?? '');
    if (q === this._query) return NO_DELTA;
    this._query = q;
    this._activeIndex = this.visibleOptions().length > 0 ? 0 : -1;
    this._notify();
    return NO_DELTA;
  }

  select(value: string): Delta {
    const v = String(value);
    if (!this.canSelect(v)) return NO_DELTA;
    this._selected = [...this._selected, v];
    if (this.closeOnSelect) this._open = false;
    this._notify();
    return { changed: true, added: [v], removed: [] };
  }

  unselect(value: string): Delta {
    const v = String(value);
    if (this.disabled) return NO_DELTA;
    const idx = this._selected.indexOf(v);
    if (idx < 0) return NO_DELTA;
    this._selected = this._selected.filter((x) => x !== v);
    this._notify();
    return { changed: true, added: [], removed: [v] };
  }

  toggle(value: string): Delta {
    return this._selected.includes(String(value))
      ? this.unselect(value)
      : this.select(value);
  }

  /** Remove the most recently selected value (e.g. Backspace on empty query). */
  unselectLast(): Delta {
    if (this._selected.length === 0) return NO_DELTA;
    const last = this._selected[this._selected.length - 1];
    if (last === undefined) return NO_DELTA;
    return this.unselect(last);
  }

  clear(): Delta {
    if (this._selected.length === 0) return NO_DELTA;
    const removed = this._selected.slice();
    this._selected = [];
    this._notify();
    return { changed: true, added: [], removed };
  }

  openListbox(): Delta {
    if (this._open || this.disabled) return NO_DELTA;
    this._open = true;
    if (this._activeIndex < 0 && this.visibleOptions().length > 0) {
      this._activeIndex = 0;
    }
    this._notify();
    return NO_DELTA;
  }

  closeListbox(): Delta {
    if (!this._open) return NO_DELTA;
    this._open = false;
    this._activeIndex = -1;
    this._notify();
    return NO_DELTA;
  }

  /** Move the active (keyboard-highlighted) option. Clamped, not wrapping. */
  moveActive(delta: number): Delta {
    const n = this.visibleOptions().length;
    if (n === 0) {
      this._activeIndex = -1;
      return NO_DELTA;
    }
    const base = this._activeIndex < 0 ? 0 : this._activeIndex;
    this._activeIndex = clamp(base + delta, 0, n - 1);
    this._notify();
    return NO_DELTA;
  }

  setActive(index: number): Delta {
    const n = this.visibleOptions().length;
    if (n === 0) {
      this._activeIndex = -1;
    } else this._activeIndex = clamp(index, 0, n - 1);
    this._notify();
    return NO_DELTA;
  }

  /** Toggle the currently-active option, if any. */
  toggleActive(): Delta {
    const list = this.visibleOptions();
    if (this._activeIndex < 0 || this._activeIndex >= list.length)
      return NO_DELTA;
    const opt = list[this._activeIndex];
    if (!opt) return NO_DELTA;
    return this.toggle(opt.value);
  }

  /**
   * If allowCreate is on and the query doesn't match an existing label,
   * add a new option with value=label=query and select it.
   */
  createFromQuery(): Delta {
    if (!this.canCreate()) return NO_DELTA;
    const q = this._query.trim();
    const opt: Option = { value: q, label: q, disabled: false };
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
   */
  async loadOptions(query?: string): Promise<Status> {
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
    } catch (err: unknown) {
      if (token !== this._loadToken) return this._status; // superseded
      this._status = LIFECYCLE.ERROR;
      this._error =
        err instanceof Error
          ? err.message
          : String(err ?? 'Unknown error');
      this._notify();
      return this._status;
    }
  }

  /**
   * Read the currently-configured OptionsSource port, if any.
   * Public accessor — adapters must use this instead of reaching into
   * the (now truly private) `_source` field.
   */
  getSource(): OptionsSource | null {
    return this._source;
  }

  setOptionsSource(source: OptionsSource | null | undefined): void {
    this._source = source ?? null;
    if (!this._source && this._status === LIFECYCLE.LOADING) {
      // Port yanked mid-flight — synthesize a terminal state.
      this._status =
        this._options.length > 0 ? LIFECYCLE.READY : LIFECYCLE.EMPTY;
      this._notify();
    }
  }

  private _clampActive(): void {
    const n = this.visibleOptions().length;
    if (n === 0) this._activeIndex = -1;
    else if (this._activeIndex >= n) this._activeIndex = n - 1;
  }
}

// ── helpers ───────────────────────────────────────────────────────

interface RawOptionObject {
  value?: unknown;
  id?: unknown;
  label?: unknown;
  text?: unknown;
  disabled?: unknown;
}

function normalizeOptions(raw: readonly unknown[] | undefined): Option[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const item of raw) {
    if (item == null) continue;
    let value: string;
    let label: string;
    let disabled: boolean;
    if (typeof item === 'object') {
      const obj = item as RawOptionObject;
      const rawVal = obj.value ?? obj.id ?? obj.label ?? obj.text;
      value = String(rawVal);
      const rawLabel = obj.label ?? obj.text ?? obj.value ?? value;
      label = String(rawLabel);
      disabled = !!obj.disabled;
    } else {
      value = String(item);
      label = String(item);
      disabled = false;
    }
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label, disabled });
  }
  return out;
}

function normalizeMax(m: number | null | undefined): number | null {
  if (m == null || (m as unknown) === '' || (m as unknown) === false) {
    return null;
  }
  const n = Number(m);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function labelCmp(a: Option, b: Option): number {
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
