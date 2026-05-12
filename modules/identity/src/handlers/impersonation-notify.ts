/**
 * Phase A7 — Notifications dispatcher for Authorization.{Impersonation,BreakGlass}*
 * events.
 *
 * Mandate (per `specs/domains/authorization/features/`):
 *   - impersonation.feature: "the customer tenant's primary admin receives
 *     a notification email" on Start; "ops engineer is notified out-of-band"
 *     on tenant_revoked End.
 *   - break-glass.feature: "the tenant's primary admin AND security@atlas
 *     pager receive notifications" on Issue.
 *
 * Atlas does not yet have a `notifications` domain, so for now the
 * dispatcher's job is to emit a structured `Notifications.*` follow-up event
 * into the `EventStore`. Downstream consumption (email / pager / SMS) is a
 * future concern — the audit log captures intent.
 *
 * Design choices:
 *   - The follow-up envelope inherits the source event's `retentionTag`
 *     (impersonation 7y, break-glass 10y) so notification audit rows live
 *     as long as their triggering event.
 *   - `idempotencyKey` is deterministic — `notif.<sourceEventId>.<channel>` —
 *     so retried dispatches dedupe at the EventStore.
 *   - The follow-up payload carries audit-grade metadata only (who, what,
 *     when, ticket / incident URL, justification). NEVER tokens, hashes,
 *     plaintext secrets, or `tokenLookup`. The dispatcher whitelists the
 *     fields it copies.
 *   - `Action`-shaped events (`Authorization.ImpersonationAction`,
 *     `Authorization.BreakGlassAction`) are recognised but produce no
 *     follow-ups — they are too noisy for per-action notifications.
 *
 * The dispatcher is offered as a separate `EventDispatcher` factory
 * (`identityNotificationDispatcher`) the wiring layer composes alongside
 * `identityDispatcher` via `composeDispatchers`. Apps that don't want
 * notifications skip composing it.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { EventDispatcher, EventStore } from '@atlas/ports';
import { newEventId } from '../ids.ts';

/** Channels the notifications dispatcher targets. */
export type NotificationChannel =
  | 'tenant_admin'
  | 'ops_pager'
  | 'security_pager'
  | 'grant_issuer';

export interface NotificationEmitOptions {
  /**
   * Optional override for who the notification should target. When unset,
   * the dispatcher derives sensible defaults from event type:
   *   - ImpersonationStarted   → tenant primary admin + ops engineer
   *   - ImpersonationEnded     → tenant primary admin (+ ops on tenant_revoked)
   *   - BreakGlassIssued       → tenant primary admin + security@atlas
   *   - BreakGlassApproved     → tenant primary admin + issuer
   *   - BreakGlassRevoked/Expired/Denied → tenant primary admin + issuer
   */
  channels?: ReadonlyArray<NotificationChannel>;
}

// =====================================================================
// Source-event recognition
// =====================================================================

/**
 * Subset of A7 event types that the dispatcher emits notifications FOR.
 * Action events are recognised in `isA7Event` but excluded here — they
 * are too noisy for per-action notifications (still go through the
 * audit log on the source side).
 */
const A7_NOTIFY_EVENT_TYPES: ReadonlySet<string> = new Set([
  'Authorization.ImpersonationStarted',
  'Authorization.ImpersonationEnded',
  'Authorization.BreakGlassIssued',
  'Authorization.BreakGlassApproved',
  'Authorization.BreakGlassDenied',
  'Authorization.BreakGlassRevoked',
  'Authorization.BreakGlassExpired',
]);

const A7_ACTION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'Authorization.ImpersonationAction',
  'Authorization.BreakGlassAction',
]);

/**
 * True when the event is part of the Phase A7 impersonation / break-glass
 * family. Action events count as A7 even though they don't trigger
 * notifications — distinguishing them from foreign events is useful for
 * the dispatcher's no-op short-circuit semantics.
 */
function isA7Event(event: EventEnvelope): boolean {
  return (
    A7_NOTIFY_EVENT_TYPES.has(event.eventType) ||
    A7_ACTION_EVENT_TYPES.has(event.eventType)
  );
}

// =====================================================================
// Default channels per event type
// =====================================================================

function defaultChannelsFor(event: EventEnvelope): ReadonlyArray<NotificationChannel> {
  const payload = event.payload;
  switch (event.eventType) {
    case 'Authorization.ImpersonationStarted':
      return ['tenant_admin', 'ops_pager'];
    case 'Authorization.ImpersonationEnded': {
      // Tenant-revoked end MUST notify ops out-of-band per spec.
      const reason =
        typeof payload === 'object' && payload !== null
          ? (payload as { reason?: unknown }).reason
          : undefined;
      if (reason === 'tenant_revoked' || reason === 'platform_revoked') {
        return ['tenant_admin', 'ops_pager'];
      }
      return ['tenant_admin'];
    }
    case 'Authorization.BreakGlassIssued':
      return ['tenant_admin', 'security_pager'];
    case 'Authorization.BreakGlassApproved':
    case 'Authorization.BreakGlassDenied':
    case 'Authorization.BreakGlassRevoked':
    case 'Authorization.BreakGlassExpired':
      return ['tenant_admin', 'grant_issuer'];
    default:
      return [];
  }
}

// =====================================================================
// Audit-grade payload extraction
// =====================================================================

/**
 * Whitelist of fields the dispatcher is willing to copy from the source
 * payload into the notification follow-up. Everything else is dropped.
 *
 * Critically, this excludes `tokenHash`, `tokenLookup`, `plaintextToken`,
 * `bearerToken`, password hashes, and any other secret-shaped field.
 * Source handlers don't put those in the payload either — but listing the
 * whitelist explicitly keeps the contract obvious and testable.
 */
const AUDIT_FIELD_WHITELIST: ReadonlySet<string> = new Set([
  // Common identifiers
  'impersonationId',
  'grantId',
  // Actors
  'operatorId',
  'targetUserId',
  'issuedBy',
  'grantedTo',
  'approvedBy',
  'deniedBy',
  'revokedBy',
  'endedBy',
  // Audit context
  'reason',
  'justification',
  'ticketUrl',
  'incidentUrl',
  'maxDurationMin',
  'expiresAt',
  'status',
  'requireApproval',
  'actionId',
  'resourceType',
  'resourceId',
  'grantedRoles',
]);

function extractAuditMetadata(
  payload: unknown,
): Record<string, unknown> {
  if (payload == null || typeof payload !== 'object') return {};
  const out: Record<string, unknown> = {};
  // `payload` is now narrowed to `object`; `Object.entries` accepts it
  // and returns `[string, unknown][]` — no structural cast needed.
  for (const [k, v] of Object.entries(payload)) {
    if (AUDIT_FIELD_WHITELIST.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

// =====================================================================
// Channel → recipient hint
// =====================================================================

/**
 * The recipient address / pager-route is resolved by the future
 * notifications domain — this dispatcher only stamps an audit-friendly
 * hint string so log readers know who SHOULD have been paged.
 */
function recipientHintFor(channel: NotificationChannel): string {
  switch (channel) {
    case 'tenant_admin':
      return 'tenant:primary_admin';
    case 'ops_pager':
      return 'pager:ops';
    case 'security_pager':
      return 'pager:security@atlas';
    case 'grant_issuer':
      return 'principal:grant_issuer';
  }
}

// =====================================================================
// Public API
// =====================================================================

/**
 * Emit `Notifications.*` follow-up events for an A7 impersonation /
 * break-glass source event. Returns the appended follow-up envelopes
 * (zero when the source event is not A7 or is an Action event, or when
 * the resolved channel set is empty).
 *
 * Idempotency: each follow-up's key is `notif.<sourceEventId>.<channel>`
 * — re-emitting against the same EventStore returns the existing record.
 */
export async function emitNotificationsForA7Event(
  event: EventEnvelope,
  eventStore: EventStore,
  opts?: NotificationEmitOptions,
): Promise<EventEnvelope[]> {
  if (!isA7Event(event)) return [];
  // Action events are recognised as A7 but never trigger notifications.
  if (A7_ACTION_EVENT_TYPES.has(event.eventType)) return [];

  const channels = opts?.channels ?? defaultChannelsFor(event);
  if (channels.length === 0) return [];

  const sourceEventId = event.eventId;
  const sourceType = event.eventType;
  const auditMetadata = extractAuditMetadata(event.payload);

  const emitted: EventEnvelope[] = [];
  for (const channel of channels) {
    const envelope: EventEnvelope = {
      eventId: newEventId(),
      eventType: `Notifications.${sourceType.replace(/^Authorization\./, '')}`,
      schemaId: `domain.notifications.${sourceType
        .replace(/^Authorization\./, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()}.v1`,
      schemaVersion: 1,
      occurredAt: event.occurredAt,
      tenantId: event.tenantId,
      correlationId: event.correlationId,
      idempotencyKey: `notif.${sourceEventId}.${channel}`,
      causationId: sourceEventId,
      principalId: event.principalId ?? null,
      userId: event.userId ?? null,
      cacheInvalidationTags: [`Tenant:${event.tenantId}`],
      ...(event.retentionTag !== undefined
        ? { retentionTag: event.retentionTag }
        : {}),
      payload: {
        sourceEventId,
        sourceEventType: sourceType,
        channel,
        recipientHint: recipientHintFor(channel),
        ...auditMetadata,
      },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    emitted.push(envelope);
  }
  return emitted;
}

/**
 * Factory: bind an `EventStore` and return an `EventDispatcher` that
 * fires `Notifications.*` follow-ups for every A7 event the chain sees.
 *
 * Compose alongside `identityDispatcher(...)` via `composeDispatchers`.
 * Apps that don't want notifications-side fan-out skip composing this.
 *
 * Note: The dispatcher returns `void` (per the `EventDispatcher` type).
 * The `emitNotificationsForA7Event` helper is also exported directly so
 * tests / explicit callers can collect the appended envelopes.
 */
export function identityNotificationDispatcher(
  eventStore: EventStore,
  opts?: NotificationEmitOptions,
): EventDispatcher {
  return async (envelope) => {
    await emitNotificationsForA7Event(envelope, eventStore, opts);
  };
}
