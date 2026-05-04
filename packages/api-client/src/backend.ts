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

/**
 * Wire-shape of a server event as delivered to subscribers (post-JSON.parse).
 * Mirrors the route's `serialize()` in `apps/server/src/routes/events.ts` —
 * `tenantId` is intentionally absent; `tags` may be omitted if the
 * originating envelope had no `cacheInvalidationTags`.
 */
export interface SerializedServerEvent {
  eventType: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  occurredAt: string;
  tags?: string[];
}

export type SerializedServerEventCallback = (
  event: SerializedServerEvent,
) => void;

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
   * Subscribe to server events of a specific event type.
   * Returns an unsubscribe function.
   *
   * Legacy API — predates tag-based routing. Callers that want to
   * react to specific resource changes should prefer `subscribeTags`,
   * which is filtered server-side and so cheaper for both peers.
   */
  subscribe(eventType: string, callback: BackendEventCallback): Unsubscribe;
  /**
   * Subscribe with a server-side tag filter. The connection is opened
   * with `?tags=…` so the server only forwards events whose
   * `cacheInvalidationTags` overlap the requested set. Multiple
   * `subscribeTags` calls with the same tag-set share a single
   * `EventSource`; the connection closes when the last subscriber for
   * that signature unsubscribes.
   */
  subscribeTags(
    tags: string[],
    callback: SerializedServerEventCallback,
  ): Unsubscribe;
}
