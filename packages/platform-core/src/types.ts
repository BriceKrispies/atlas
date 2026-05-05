export interface EventEnvelope {
  eventId: string;
  eventType: string;
  schemaId: string;
  schemaVersion: number;
  occurredAt: string;
  tenantId: string;
  correlationId: string;
  idempotencyKey: string;
  causationId?: string | null;
  principalId?: string | null;
  userId?: string | null;
  cacheInvalidationTags?: string[] | null;
  /**
   * Phase A4 — audit retention tier. Stamped at emit time; never
   * mutated downstream.
   *
   *   - `retention:1y`           — default for non-sensitive events
   *   - `retention:7y`           — impersonation events (Phase A7)
   *   - `retention:10y`          — break-glass events (Phase A7)
   *   - `retention:tenant-policy:<n>y` — tenant-extended retention
   *     above the default 1y (tenant policies can lengthen but
   *     never shorten platform-set tiers)
   *
   * The audit-export pipeline (Phase A4.9) reads this tag; the
   * platform-side cleanup job uses it to gate row-level deletes.
   */
  retentionTag?: string;
  payload: unknown;
  /**
   * Per-tenant monotonic sequence number, populated by the EventStore on
   * append. Workers consume events in seq order using a per-(module,
   * tenant) cursor. Optional in the type because callers constructing an
   * envelope to append don't supply it — the store does. After append it
   * is guaranteed present.
   *
   * Postgres backing: `seq BIGSERIAL` per-tenant. IDB backing: synthesized
   * monotonic per-tenant counter. Use `bigint` rather than `number` to
   * keep the 64-bit sequence space honest, even though JS numbers can
   * safely represent up to 2^53.
   */
  seq?: bigint;
}

export interface IntentEnvelope {
  eventId?: string;
  eventType: string;
  schemaId: string;
  schemaVersion: number;
  occurredAt?: string;
  tenantId: string;
  correlationId: string;
  idempotencyKey: string;
  causationId?: string | null;
  principalId?: string | null;
  userId?: string | null;
  payload: IntentPayload;
}

export interface IntentPayload {
  actionId: string;
  resourceType: string;
  resourceId?: string | null;
  [k: string]: unknown;
}

export interface IntentResponse {
  eventId: string;
  tenantId: string;
  principalId: string | null;
}

export interface Principal {
  principalId: string;
  tenantId: string;
  /**
   * Identity-domain User this principal resolved to. Set by the principal
   * middleware after JWT validation when a `User` entity matches the
   * primary IDP subject. Null when there's no matching User (first-login
   * before invite-accept, or operator/service principals that don't have
   * Identity records). Authz layers that need RBAC consult this.
   */
  userId?: string | null;
  /**
   * Roles granted by the principal's `Membership` in the request tenant.
   * Hydrated by the principal middleware. Empty array when there's no
   * Membership (the request fails authz unless the policy allows
   * unauthenticated access — only the seed bootstrap and health probes do).
   */
  roles?: string[];
  /**
   * Free-form attributes surfaced to the policy engine on `evaluate`.
   * Lets ABAC rules reference principal-side facts (department, region,
   * employmentStatus, …). Phase A1 populates from the User entity's
   * `attrs`; Phase A4 (SCIM) extends with provisioned claims.
   */
  attributes?: Record<string, unknown>;
}

export interface SearchDocument {
  documentId: string;
  documentType: string;
  tenantId: string;
  fields: Record<string, unknown>;
  permissionAttributes?: { allowedPrincipals: string[] } | null;
}

export interface CacheSetOptions {
  ttlSeconds: number;
  tags: ReadonlyArray<string>;
}

/**
 * A server-side event published to connected clients via SSE or WebSocket.
 *
 * Mirrors `crates/ingress/src/events.rs::ServerEvent`. Intentionally
 * minimal: clients receive the event type and resource identifiers, then
 * query the API for full data if needed.
 *
 * `tenantId` is used by the SSE handler to filter the per-subscriber
 * stream. The Rust counterpart marks it `#[serde(skip)]` so it never
 * leaves the server; the TS handler likewise omits it from the wire
 * payload before serialising.
 */
export interface ServerEvent {
  /** Domain event type (e.g., "projection.updated", "cache.invalidated") */
  eventType: string;
  /** Tenant this event belongs to — used for filtering, never sent to client. */
  tenantId: string;
  /** Resource type affected (e.g., "page", "badge", "cache") */
  resourceType: string;
  /** Resource identifier */
  resourceId: string;
  /** Correlation ID linking to the originating user action */
  correlationId: string;
  /** ISO 8601 timestamp */
  occurredAt: string;
  /**
   * Cache-invalidation tags carried over from the originating
   * `EventEnvelope.cacheInvalidationTags`. Used by the SSE route to
   * filter per subscriber via `?tags=` and by client-side surfaces to
   * decide whether to refetch. These ARE the same tags the cache uses —
   * the wire shape is intentional, not a re-derivation.
   */
  tags?: ReadonlyArray<string>;
}

/**
 * Analytics event matching the Rust `AnalyticsEvent` shape
 * (`crates/core/src/types.rs`), surfaced for the TS `AnalyticsStore` port.
 *
 * `occurredAt` is an ISO-8601 timestamp string (the TS surface uses
 * lexicographic comparison for time-window filters; ISO-8601 sorts the
 * same way chronologically).
 */
export interface AnalyticsEvent {
  tenantId: string;
  eventType: string;
  occurredAt: string;
  principalId?: string;
  properties: Record<string, unknown>;
}
