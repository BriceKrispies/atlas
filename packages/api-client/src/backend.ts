/**
 * Backend interface definition.
 *
 * All data access goes through this contract. Two implementations:
 * - mock (in-memory, default) — for frontend-only development
 * - http (real ingress API) — swap in via VITE_BACKEND=http
 *
 * Components never import an implementation directly.
 */

export type BackendEventCallback = (event: unknown) => void;
export type Unsubscribe = () => void;

export interface Backend {
  /**
   * Fetch a resource. Path maps to API routes (e.g., '/pages', '/pages/pg_001').
   */
  query(path: string): Promise<unknown>;
  /**
   * Submit a write operation. For the real backend, this posts an intent.
   */
  mutate(path: string, body: Record<string, unknown>): Promise<unknown>;
  /**
   * Subscribe to server events. Returns an unsubscribe function.
   */
  subscribe(eventType: string, callback: BackendEventCallback): Unsubscribe;
}
