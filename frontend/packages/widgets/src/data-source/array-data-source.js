/**
 * arrayDataSource — static in-memory DataSource for tests and sandbox specimens.
 *
 * Shape:
 *   const ds = arrayDataSource([{ id: 1, title: 'a' }, …]);
 *   await ds.fetchAll();  // { rows, total }
 *
 * The returned object also exposes `setRows(next)` so specimens can replace
 * the underlying data without recreating the DataSource; any subscribers
 * receive a `reload` patch.
 */

/** @typedef {import('./types.js').DataSource} DataSource */
/** @typedef {import('./types.js').Row} Row */
/** @typedef {import('./types.js').RowPatch} RowPatch */

/**
 * @param {Row[]} [initial]
 * @returns {DataSource & { setRows: (rows: Row[]) => void, emit: (patch: RowPatch) => void }}
 */
export function arrayDataSource(initial = []) {
  let rows = Array.isArray(initial) ? initial.slice() : [];
  /** @type {Set<(patch: RowPatch) => void>} */
  const listeners = new Set();

  return {
    capabilities: ['sort', 'filter', 'page', 'stream'],

    async fetchAll() {
      return { rows: rows.slice(), total: rows.length };
    },

    subscribe(cb) {
      if (typeof cb !== 'function') return () => {};
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    setRows(next) {
      rows = Array.isArray(next) ? next.slice() : [];
      for (const cb of listeners) {
        try { cb({ type: 'reload' }); } catch { /* listener errors don't corrupt */ }
      }
    },

    emit(patch) {
      for (const cb of listeners) {
        try { cb(patch); } catch { /* swallow */ }
      }
    },
  };
}
