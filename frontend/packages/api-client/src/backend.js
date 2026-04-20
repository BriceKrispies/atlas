/**
 * Backend interface definition.
 *
 * All data access goes through this contract. Two implementations:
 * - mock (in-memory, default) — for frontend-only development
 * - http (real ingress API) — swap in via VITE_BACKEND=http
 *
 * Components never import an implementation directly.
 *
 * @typedef {Object} Backend
 * @property {(path: string) => Promise<*>} query
 *   Fetch a resource. Path maps to API routes (e.g., '/pages', '/pages/pg_001').
 * @property {(path: string, body: Object) => Promise<*>} mutate
 *   Submit a write operation. For the real backend, this posts an intent.
 * @property {(eventType: string, callback: (event: Object) => void) => () => void} subscribe
 *   Subscribe to server events. Returns an unsubscribe function.
 */

/** @type {Backend} */
export const BackendInterface = /** @type {*} */ (null);
