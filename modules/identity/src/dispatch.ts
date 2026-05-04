/**
 * Identity event dispatcher.
 *
 * Persists `Identity.*` event payloads to entities + relations.
 * Cache-tag invalidation lives in the wiring layer's
 * `cacheTagDispatcher` — do not call cache here.
 *
 * Storage model:
 *   - User      → entities (`tenantId='_platform'`, type='User')
 *   - Membership→ entities (`tenantId=<tenant>`, type='Membership')
 *                 plus a `membership.user` edge in relations
 *   - InviteToken → entities (`tenantId=<tenant>`, type='InviteToken')
 *                   plus optional `invite.user` edge on accept
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type {
  Cache,
  EntityStore,
  EventDispatcher,
  RelationStore,
} from '@atlas/ports';
import type {
  InviteTokenDocument,
  MembershipDocument,
  UserDocument,
} from './types.ts';
import { putUserEntity } from './entities/user.ts';
import { putMembershipEntity } from './entities/membership.ts';
import { putInviteTokenEntity } from './entities/invite-token.ts';
import {
  linkInviteToUser,
  linkMembershipToUser,
} from './entities/relations.ts';

export interface IdentityDispatchContext {
  entities: EntityStore;
  relations: RelationStore;
  cache?: Cache;
}

const HANDLED_EVENT_TYPES = new Set([
  'Identity.UserCreated',
  'Identity.MembershipCreated',
  'Identity.InviteIssued',
  'Identity.InviteAccepted',
]);

export async function dispatchIdentityEvent(
  envelope: EventEnvelope,
  ctx: IdentityDispatchContext,
): Promise<void> {
  if (!HANDLED_EVENT_TYPES.has(envelope.eventType)) return;

  const payload = envelope.payload as Record<string, unknown>;
  const document = payload['document'] as
    | UserDocument
    | MembershipDocument
    | InviteTokenDocument
    | undefined;
  if (!document) return;

  if (envelope.eventType === 'Identity.UserCreated') {
    await putUserEntity(ctx.entities, document as UserDocument, envelope.tenantId);
  } else if (envelope.eventType === 'Identity.MembershipCreated') {
    const m = document as MembershipDocument;
    await putMembershipEntity(ctx.entities, m);
    await linkMembershipToUser(ctx.relations, m.tenantId, m.userId);
  } else if (envelope.eventType === 'Identity.InviteIssued') {
    await putInviteTokenEntity(ctx.entities, document as InviteTokenDocument);
  } else if (envelope.eventType === 'Identity.InviteAccepted') {
    const t = document as InviteTokenDocument;
    await putInviteTokenEntity(ctx.entities, t);
    if (t.acceptedUserId) {
      await linkInviteToUser(
        ctx.relations,
        t.tenantId,
        t.tokenId,
        t.acceptedUserId,
      );
    }
  }
}

/**
 * Factory: bind an `IdentityDispatchContext` and return an
 * `EventDispatcher`. Designed for `composeDispatchers`.
 */
export function identityDispatcher(
  ctx: IdentityDispatchContext,
): EventDispatcher {
  return (envelope) => dispatchIdentityEvent(envelope, ctx);
}
