/**
 * Wire CedarPolicyEngine.invalidate(tenantId) to cache-tag events.
 *
 * The engine caches parsed bundles per-tenant; activations / archives
 * mutate `control_plane.policies` and emit cache invalidation tags
 * (`Tenant:{tenantId}` + `Policy:{policyId}`) on the event pipeline. This
 * tiny adapter subscribes to those tags and calls `engine.invalidate` so
 * the next evaluate sees the fresh bundle.
 *
 * Kept deliberately minimal: there is no cross-package event-bus port
 * yet — the apps that wire this (apps/server) already have an in-process
 * dispatcher with hooks. We expose an `applyCacheTags` adapter so the
 * caller can route any tag list at it. If/when a formal `EventBus` port
 * lands, this module sprouts a constructor that takes one.
 */

import type { CedarPolicyEngine } from './cedar-policy-engine.ts';

const TENANT_TAG_PREFIX = 'Tenant:';
const POLICY_TAG_PREFIX = 'Policy:';

/**
 * Subset of the Cedar engine the wirer actually calls. Lets the
 * dispatcher pass anything that exposes `invalidate(tenantId)` (e.g. a
 * test double).
 */
export interface CedarBundleCache {
  invalidate(tenantId: string): void;
  invalidateAll(): void;
}

/**
 * Inspect a tag list and invalidate the engine's bundle cache when a
 * `Tenant:{id}` tag is present. `Policy:{policyId}` tags are also handled
 * — they don't carry the tenant id directly, so callers MUST pair them
 * with a `Tenant:{id}` tag (which the activation handler does today).
 *
 * Returns the set of tenant ids invalidated; useful for tests / logging.
 */
export function applyCacheTags(
  engine: CedarBundleCache,
  tags: ReadonlyArray<string> | null | undefined,
): Set<string> {
  const invalidated = new Set<string>();
  if (!tags || tags.length === 0) return invalidated;

  let policyTagSeenWithoutTenant = false;
  for (const tag of tags) {
    if (tag.startsWith(TENANT_TAG_PREFIX)) {
      const tenantId = tag.slice(TENANT_TAG_PREFIX.length);
      if (tenantId.length > 0) {
        engine.invalidate(tenantId);
        invalidated.add(tenantId);
      }
    } else if (tag.startsWith(POLICY_TAG_PREFIX)) {
      // Policy tags without a paired Tenant tag mean we don't know which
      // tenant owns the policy; fall through to a per-policy tag-only path
      // by remembering and acting after the loop. (Today's emitters always
      // pair the two; this branch is belt-and-braces.)
      policyTagSeenWithoutTenant = true;
    }
  }

  if (policyTagSeenWithoutTenant && invalidated.size === 0) {
    // Fallback: a Policy:* tag without any Tenant:* tag means we can't
    // safely target a single bundle cache entry. Wipe the lot rather than
    // serving stale policy. Cheap — the cache is typically <100 entries.
    engine.invalidateAll();
  }

  return invalidated;
}

/**
 * Convenience wirer for callers that already have a per-event hook. The
 * returned function can be plugged into a dispatcher's "after-dispatch"
 * callback chain.
 *
 *   const onEvent = wirePolicyCacheInvalidation(engine);
 *   dispatcher.after((envelope) => onEvent(envelope.cacheInvalidationTags));
 */
export function wirePolicyCacheInvalidation(
  engine: CedarPolicyEngine,
): (tags: ReadonlyArray<string> | null | undefined) => void {
  return (tags) => {
    applyCacheTags(engine, tags);
  };
}
