/**
 * Principal-cache invalidation dispatcher.
 *
 * Watches events for `User:<userId>` and `Membership:<tenantId>:<userId>`
 * tags and drops the corresponding cached principal in `PrincipalCache`.
 * Companion to `cacheTagDispatcher` for an in-process cache that lives
 * outside the `Cache` port (which is Postgres-backed; round-tripping the
 * cache *of* the principal through Postgres would defeat the point).
 *
 * Composed into the inline dispatcher chain in `middleware/state.ts`
 * AFTER `cache-tag` (preserving the worker-chain prefix-parity rule —
 * see `apps/projection-worker/src/tenant-loop.ts`
 * `WORKER_DISPATCHER_CHAIN_NAMES`).
 *
 * Async-mode caveat: in `WORKER_MODE=async`, events are processed by
 * `apps/projection-worker`, not the server — and the worker has no
 * `PrincipalCache` to invalidate. Server-side cached principals are
 * stale for up to `PrincipalCache.positiveTtlMs` (60s default) in that
 * mode. The TTL is the fallback for exactly this case; the dispatcher
 * is the fast path for the inline default.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { PrincipalCache } from '@atlas/platform-core';
import type { EventDispatcher } from '@atlas/ports';

const USER_TAG = /^User:(.+)$/;
const MEMBERSHIP_TAG = /^Membership:([^:]+):(.+)$/;
const TENANT_TAG = /^Tenant:(.+)$/;

export function principalCacheDispatcher(cache: PrincipalCache): EventDispatcher {
  return async function (envelope: EventEnvelope) {
    const tags = envelope.cacheInvalidationTags;
    if (!tags || tags.length === 0) return;

    // Buffer matches so we don't call into the cache for every tag —
    // tag fanout on an identity event is typically 2-3 entries, so
    // walking once and dedup'ing matters less than keeping the loop
    // straight-line.
    for (const tag of tags) {
      const membershipMatch = MEMBERSHIP_TAG.exec(tag);
      if (membershipMatch) {
        const [, tenantId, userId] = membershipMatch;
        if (tenantId && userId) cache.invalidate(tenantId, userId);
        continue;
      }
      const userMatch = USER_TAG.exec(tag);
      if (userMatch) {
        const userId = userMatch[1];
        if (userId) cache.invalidate(envelope.tenantId, userId);
        continue;
      }
      const tenantMatch = TENANT_TAG.exec(tag);
      if (tenantMatch) {
        const tenantId = tenantMatch[1];
        if (tenantId) cache.invalidateTenant(tenantId);
      }
    }
  };
}
