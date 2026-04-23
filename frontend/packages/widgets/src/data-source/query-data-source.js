/**
 * queryDataSource — DataSource backed by the Atlas backend adapter.
 *
 * Example:
 *   queryDataSource(backend, '/pages', { resourceType: 'page' })
 *
 * Behaviour:
 *   - fetchAll() calls backend.query(path) and normalizes array or {rows} envelope.
 *   - subscribe(cb) subscribes to backend.subscribe('projection.updated') and,
 *     for events matching `resourceType`, emits a patch to `cb`.
 *   - Default patch on every matching event: { type: 'reload' }. This matches
 *     how admin surfaces currently reload after SSE events (zero regression).
 *   - Opt-in per-row patching: pass `{ onEvent: (ev) => patch | null }` and
 *     convert an SSE event into an explicit upsert/remove to keep scroll/
 *     selection state across streaming updates.
 */

/** @typedef {import('./types.js').DataSource} DataSource */
/** @typedef {import('./types.js').Row} Row */
/** @typedef {import('./types.js').RowPatch} RowPatch */

/**
 * @typedef {Object} BackendLike
 * @property {(path: string) => Promise<any>} query
 * @property {(eventType: string, cb: (event: any) => void) => () => void} [subscribe]
 *
 * @typedef {Object} QueryDataSourceOptions
 * @property {string} [resourceType] — when set, only events with this
 *   resourceType trigger a patch.
 * @property {(event: any) => (RowPatch | null | undefined)} [onEvent] —
 *   custom event-to-patch converter. Return null to ignore the event.
 * @property {string} [eventType] — SSE event type to subscribe to.
 *   Defaults to `'projection.updated'`.
 */

/**
 * @param {BackendLike} backend
 * @param {string} path
 * @param {QueryDataSourceOptions} [options]
 * @returns {DataSource}
 */
export function queryDataSource(backend, path, options = {}) {
  const resourceType = options.resourceType ?? null;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  const eventType = options.eventType ?? 'projection.updated';

  const capabilities = ['sort', 'filter', 'page'];
  if (typeof backend?.subscribe === 'function') capabilities.push('stream');

  return {
    capabilities,

    async fetchAll() {
      const result = await backend.query(path);
      const rows = Array.isArray(result)
        ? result
        : Array.isArray(result?.rows)
          ? result.rows
          : [];
      const total = typeof result?.total === 'number' ? result.total : rows.length;
      return { rows, total };
    },

    subscribe(cb) {
      if (typeof cb !== 'function' || typeof backend?.subscribe !== 'function') {
        return () => {};
      }
      return backend.subscribe(eventType, (event) => {
        if (resourceType && event?.resourceType !== resourceType) return;
        if (onEvent) {
          const patch = onEvent(event);
          if (patch && typeof patch === 'object') cb(patch);
          return;
        }
        cb({ type: 'reload' });
      });
    },
  };
}
