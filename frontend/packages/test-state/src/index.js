/**
 * @atlas/test-state — dev-only registry that exposes interaction state to
 * Playwright via `window.__atlasTest`.
 *
 * Surfaces call `registerTestState(key, reader)` with a key like
 * `chart:<id>`, `editor:<id>`, `layout`, `drag:layout`. The reader is a
 * zero-arg function returning a JSON-safe snapshot of the surface's
 * externally-observable state, including `lastCommit` (see
 * specs/frontend/interaction-contracts.md).
 *
 * In production builds `import.meta.env.DEV` is false, so the registry map
 * is never allocated and every call is a no-op that bundlers can strip.
 */

// Vite replaces `import.meta.env.DEV` with a boolean literal at build time,
// so in prod bundles this becomes `const DEV_MODE = false;` and every
// `if (DEV_MODE)` / `DEV_MODE ? … : …` below dead-code eliminates.
const DEV_MODE = import.meta.env.DEV;

/** @type {Map<string, () => unknown> | null} */
const readers = DEV_MODE ? new Map() : null;

/**
 * Register a reader for a state key. Returns an unregister function.
 * In prod this is a no-op.
 * @param {string} key
 * @param {() => unknown} reader
 * @returns {() => void}
 */
export function registerTestState(key, reader) {
  if (!DEV_MODE || !readers) return () => {};
  readers.set(key, reader);
  ensureInstalled();
  return () => {
    if (readers.get(key) === reader) readers.delete(key);
  };
}

/**
 * Explicitly unregister a key. Prefer the disposer returned by
 * registerTestState.
 * @param {string} key
 */
export function unregisterTestState(key) {
  if (!DEV_MODE || !readers) return;
  readers.delete(key);
}

let installed = false;

function ensureInstalled() {
  if (installed || !DEV_MODE || !readers) return;
  if (typeof window === 'undefined') return;

  const api = {
    /** Full snapshot of every registered reader. */
    getState() {
      const out = {};
      for (const [key, reader] of readers) {
        try {
          out[key] = reader();
        } catch (err) {
          out[key] = { error: String(err) };
        }
      }
      return out;
    },

    /** Snapshot of one chart by id. */
    getChartState(id) {
      const r = readers.get(`chart:${id}`);
      return r ? r() : null;
    },

    /** Snapshot of one editor (layout or block) by id. */
    getEditorState(id) {
      const r = readers.get(`editor:${id}`);
      return r ? r() : null;
    },

    /** Snapshot of the layout editor (alias for getEditorState). */
    getLayoutState(id) {
      const r = readers.get(`editor:${id}`) ?? readers.get('layout');
      return r ? r() : null;
    },

    /** Snapshot of the active drag session, if any. */
    getDragState(surface = 'layout') {
      const r = readers.get(`drag:${surface}`);
      return r ? r() : null;
    },

    /**
     * The last commit recorded by a surface. `surfaceKey` matches the
     * registry key (e.g. `chart:sales`, `editor:page-123`).
     */
    getLastCommit(surfaceKey) {
      const r = readers.get(surfaceKey);
      if (!r) return null;
      try {
        return r().lastCommit ?? null;
      } catch {
        return null;
      }
    },

    /** List of registered keys — handy for debugging. */
    keys() {
      return [...readers.keys()];
    },
  };

  Object.defineProperty(window, '__atlasTest', {
    value: api,
    writable: false,
    configurable: true,
  });
  installed = true;
}

/**
 * Build a commit record. Surfaces call this after mutating state so the
 * reader's `lastCommit` field matches the interaction-contracts.md envelope.
 * @param {string} surfaceId
 * @param {string} intent
 * @param {unknown} patch
 */
export function makeCommit(surfaceId, intent, patch) {
  return { surfaceId, intent, patch, at: Date.now() };
}
