/**
 * Deterministic id helpers for the identity module.
 * Mirrors `@atlas/content-pages`'s `ids.ts` so dispatch can stamp
 * envelope ids the same way across modules.
 */

export function newEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newUserId(): string {
  return `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newMembershipId(): string {
  return `mbr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newInviteTokenId(): string {
  return `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Membership entity_id is deterministic from (tenantId, userId). One
 * Membership per user-per-tenant; this lets handlers do an idempotent
 * upsert without a uniqueness index lookup. (The substrate's
 * (tenant_id, entity_type, entity_id) PK enforces uniqueness for free.)
 */
export function membershipEntityIdFor(userId: string): string {
  return `m:${userId}`;
}
