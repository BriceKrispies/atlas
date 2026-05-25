/**
 * The BFF → client server-event contract (ADR 0017, constitution C15).
 *
 * The kernel's `channel(opts?)` opens `{BFF}/events?tags=…`; the BFF pipes the
 * upstream `apps/server` SSE through. `ChannelEvent` is the per-frame shape the
 * browser receives — the backend `ServerEvent` minus `tenantId`, which is used
 * for upstream filtering and never leaves the server.
 */

/** A single server-pushed event frame delivered over the channel. */
export interface ChannelEvent {
  eventType: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  occurredAt: string;
  /** Cache-invalidation tags; the kernel invalidates matching queries (never touches the DOM). */
  tags?: readonly string[];
}

/** The kernel's subscription request — the tags it wants frames for. */
export interface ChannelSubscription {
  tags: readonly string[];
}
