/**
 * Phase A3.6 — JIT (just-in-time) user provisioning from a verified JWT.
 *
 * Called by the principal middleware AFTER JWT signature + audience +
 * issuer have been verified. Resolves the JWT to a User; if no User
 * matches and the IDP allows it, mints User + Membership in one atomic
 * write-then-dispatch chain.
 *
 * Group-claim → role mapping (A3.7) is applied in the same pass: when
 * the IDP carries `roleMappings`, the JWT's group claim drives the
 * Membership.roles set. On returning logins (User already exists),
 * Membership.roles is RECONCILED — groups added/removed in the IDP
 * propagate to the next login. (Mid-session changes don't reflect
 * until the next refresh; that's the standard tradeoff.)
 */

import {
  PLATFORM_ROBOT_PRINCIPAL_ID,
  type EventEnvelope,
} from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  IdentityProviderDocument,
  MembershipDocument,
  RoleMapping,
  UserDocument,
} from '../types.ts';
import { handleUserCreate } from './user-create.ts';
import { findUserByIdpSubject } from '../entities/user.ts';
import {
  getMembershipEntity,
  putMembershipEntity,
} from '../entities/membership.ts';
import { newEventId, newMembershipId } from '../ids.ts';
import { handleMembershipCreate } from './membership-create.ts';

export interface JitClaims {
  /** JWT `sub` — the IDP-side identifier we key on. */
  sub: string;
  /** Email claim, used to populate the User. */
  email?: string;
  given_name?: string;
  family_name?: string;
  /**
   * Raw claims object — used for resolving `idp.groupClaimPath`
   * which can be a dotted path (e.g. `realm_access.roles`).
   */
  raw: Record<string, unknown>;
}

export interface JitProvisionCommand {
  tenantId: string;
  correlationId: string;
  claims: JitClaims;
  idp: IdentityProviderDocument;
}

export interface JitProvisionResult {
  user: UserDocument;
  membership: MembershipDocument;
  /** Events appended during provisioning (UserCreated, MembershipCreated, MembershipRolesChanged). */
  events: EventEnvelope[];
  /** True when this call CREATED the User (vs. resolved an existing one). */
  created: boolean;
}

/**
 * Walk a dotted JSON path on a claims object. `'realm_access.roles'`
 * resolves to `claims.realm_access.roles`. Returns `undefined` for
 * missing paths or non-array leaf values.
 */
function readGroupClaim(
  raw: Record<string, unknown>,
  path: string,
): string[] {
  const parts = path.split('.').filter(Boolean);
  let cursor: unknown = raw;
  for (const p of parts) {
    if (typeof cursor !== 'object' || cursor === null) return [];
    cursor = (cursor as Record<string, unknown>)[p];
  }
  if (!Array.isArray(cursor)) return [];
  return cursor.filter((v): v is string => typeof v === 'string');
}

/**
 * Resolve the role set for a JWT login by intersecting the JWT's
 * group claim with the IDP's `roleMappings`. When `roleMappings` is
 * empty, falls back to `defaultRolesOnFirstLogin`.
 */
function resolveRolesForLogin(
  idp: IdentityProviderDocument,
  claims: JitClaims,
): string[] {
  const groupPath = idp.groupClaimPath ?? 'groups';
  const groups = readGroupClaim(claims.raw, groupPath);
  if (idp.roleMappings.length === 0 || groups.length === 0) {
    return [...idp.defaultRolesOnFirstLogin];
  }
  const set = new Set<string>();
  const groupsLower = groups.map((g) => g.toLowerCase());
  for (const m of idp.roleMappings as ReadonlyArray<RoleMapping>) {
    if (groupsLower.includes(m.group.toLowerCase())) {
      for (const r of m.roles) set.add(r);
    }
  }
  // No group matched → still grant the IDP's default roles. This is
  // the conservative choice — enterprises that want "no groups, no
  // access" should set `defaultRolesOnFirstLogin: []`.
  if (set.size === 0) {
    return [...idp.defaultRolesOnFirstLogin];
  }
  return Array.from(set);
}

export async function handleJitProvision(
  cmd: JitProvisionCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<JitProvisionResult> {
  const events: EventEnvelope[] = [];

  const existing = await findUserByIdpSubject(
    entities,
    cmd.tenantId,
    cmd.claims.sub,
  );
  const desiredRoles = resolveRolesForLogin(cmd.idp, cmd.claims);

  if (existing) {
    // Returning user. Reconcile Membership.roles when groups changed.
    let membership = await getMembershipEntity(
      entities,
      cmd.tenantId,
      existing.userId,
    );
    if (!membership) {
      // Edge case: User exists but no Membership. Mint it. (Possible
      // if a tenant cloned a user out of one tenant into another
      // manually, or after a botched migration.)
      const created = await handleMembershipCreate(
        {
          tenantId: cmd.tenantId,
          correlationId: cmd.correlationId,
          principalId: existing.userId,
          userId: existing.userId,
          roles: desiredRoles,
        },
        eventStore,
        entities,
      );
      events.push(created.envelope);
      membership = created.document;
    } else {
      // Reconcile roles. Only emit an event when the set changed.
      const desiredSorted = [...desiredRoles].sort();
      const currentSorted = [...membership.roles].sort();
      const same =
        desiredSorted.length === currentSorted.length &&
        desiredSorted.every((r, i) => r === currentSorted[i]);
      if (!same) {
        const occurredAt = new Date().toISOString();
        const updated: MembershipDocument = {
          ...membership,
          roles: [...desiredRoles],
          updatedAt: occurredAt,
        };
        await putMembershipEntity(entities, updated);
        const env: EventEnvelope = {
          eventId: newEventId(),
          eventType: 'Identity.MembershipRolesChanged',
          schemaId: 'domain.identity.membership.roles_changed.v1',
          schemaVersion: 1,
          occurredAt,
          tenantId: cmd.tenantId,
          correlationId: cmd.correlationId,
          idempotencyKey: `identity.membership.roles-changed.${cmd.tenantId}.${existing.userId}.${occurredAt}`,
          causationId: null,
          principalId: existing.userId,
          userId: existing.userId,
          cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `User:${existing.userId}`,
            `Membership:${cmd.tenantId}:${existing.userId}`,
          ],
          payload: {
            document: updated,
            previousRoles: membership.roles,
            source: 'jwt_group_claim',
          },
        };
        const stored = await eventStore.append(env);
        env.eventId = stored.eventId;
        env.seq = stored.seq;
        events.push(env);
        membership = updated;
      }
    }
    return { user: existing, membership, events, created: false };
  }

  // No User matches — JIT provisioning path.
  if (cmd.idp.requireInvite) {
    throw new IdentityError(
      codes.JIT_PROVISIONING_DISABLED,
      `IdP ${cmd.idp.idpId} requires invite before login (no User found for sub=${cmd.claims.sub})`,
      403,
    );
  }

  const userResult = await handleUserCreate(
    {
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      // JIT provisioning runs before any User exists for this subject;
      // the bootstrap robot is the calling actor (ADR 0008 §2).
      principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
      email: cmd.claims.email ?? `${cmd.claims.sub}@unknown.invalid`,
      primaryIdpSubject: cmd.claims.sub,
      ...(cmd.claims.given_name !== undefined ? { givenName: cmd.claims.given_name } : {}),
      ...(cmd.claims.family_name !== undefined ? { familyName: cmd.claims.family_name } : {}),
    },
    eventStore,
  );
  events.push(userResult.envelope);

  const membershipDoc: MembershipDocument = {
    membershipId: newMembershipId(),
    tenantId: cmd.tenantId,
    userId: userResult.document.userId,
    roles: [...desiredRoles],
    status: 'active',
    createdAt: userResult.document.createdAt,
    updatedAt: userResult.document.createdAt,
  };
  // We hand-craft the MembershipCreated event rather than calling
  // `handleMembershipCreate` because the latter requires the User
  // to ALREADY exist in the entity store — but it was just emitted
  // a moment ago and won't land until the dispatcher runs. The
  // direct write avoids that ordering pitfall and matches what the
  // dispatcher would do anyway.
  const occurredAt = userResult.document.createdAt;
  const membershipEvent: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.MembershipCreated',
    schemaId: 'domain.identity.membership.created.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.membership.create.${cmd.tenantId}.${userResult.document.userId}`,
    causationId: null,
    // System-initiated MembershipCreated on first JIT login —
    // attributed to the bootstrap robot (ADR 0008 §2).
    principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
    userId: null,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${userResult.document.userId}`,
      `Membership:${cmd.tenantId}:${userResult.document.userId}`,
    ],
    payload: { document: membershipDoc, source: 'jit_provision' },
  };
  const storedM = await eventStore.append(membershipEvent);
  membershipEvent.eventId = storedM.eventId;
  membershipEvent.seq = storedM.seq;
  events.push(membershipEvent);

  return {
    user: userResult.document,
    membership: membershipDoc,
    events,
    created: true,
  };
}
