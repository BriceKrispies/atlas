/**
 * Identity handler unit tests.
 *
 * Exercises user-create / membership-create / invite-issue / invite-accept
 * against in-memory implementations of EventStore, EntityStore, and
 * RelationStore. Asserts the I12 invariant: the dispatcher rebuilds the
 * post-state from event history alone.
 */

import { describe, it, expect } from 'vitest';
import type {
  EventStore,
  StoredEvent,
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStatus,
  EntityStore as PortEntityStore,
  EntityWriteInput,
  Relation,
  RelationStore,
  RelationWriteInput,
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  handleUserCreate,
  handleMembershipCreate,
  handleInviteIssue,
  handleInviteAccept,
  dispatchIdentityEvent,
  getUserEntity,
  getMembershipEntity,
  getInviteTokenEntity,
  IdentityError,
  identityErrorCodes,
  hashSecret,
  lookupOf,
  type UserDocument,
} from '../src/index.ts';

class InMemoryEventStore implements EventStore {
  events: EventEnvelope[] = [];
  private nextSeq = 0n;
  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    this.nextSeq += 1n;
    const stored: StoredEvent = { ...envelope, seq: this.nextSeq };
    this.events.push(stored);
    return stored;
  }
  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    return this.events.find((e) => e.eventId === eventId) ?? null;
  }
  async readEvents(): Promise<EventEnvelope[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

class InMemoryEntityStore implements PortEntityStore {
  rows = new Map<string, Entity<unknown>>();
  private k(t: string, ty: string, id: string): string {
    return `${t}::${ty}::${id}`;
  }
  async get<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<Entity<TAttrs> | null> {
    const row = this.rows.get(this.k(tenantId, entityType, entityId));
    if (!row || row.status === 'deleted') return null;
    return row as Entity<TAttrs>;
  }
  async put<TAttrs = unknown>(
    input: EntityWriteInput<TAttrs>,
  ): Promise<Entity<TAttrs>> {
    const key = this.k(input.tenantId, input.entityType, input.entityId);
    const existing = this.rows.get(key);
    const now = new Date().toISOString();
    const row: Entity<TAttrs> = {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      schemaVersion: input.schemaVersion ?? 1,
      attrs: input.attrs,
      status: input.status ?? 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(key, row as Entity<unknown>);
    return row;
  }
  async delete(t: string, ty: string, id: string): Promise<void> {
    const key = this.k(t, ty, id);
    const existing = this.rows.get(key);
    if (existing) {
      this.rows.set(key, { ...existing, status: 'deleted' });
    }
  }
  async list<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts?: EntityListOptions,
  ): Promise<Entity<TAttrs>[]> {
    const desiredStatus: EntityStatus | null =
      opts?.status === undefined ? 'active' : opts.status;
    return Array.from(this.rows.values())
      .filter((r) => r.tenantId === tenantId && r.entityType === entityType)
      .filter((r) => (desiredStatus === null ? true : r.status === desiredStatus))
      .sort((a, b) =>
        a.entityId.localeCompare(b.entityId),
      ) as Entity<TAttrs>[];
  }
  async query<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts: EntityQueryOptions,
  ): Promise<Entity<TAttrs>[]> {
    const base = await this.list<TAttrs>(tenantId, entityType, opts);
    if (!opts.attrsEqual) return base;
    const predicates = Object.entries(opts.attrsEqual);
    return base.filter((row) => {
      const attrs = row.attrs as Record<string, unknown>;
      return predicates.every(([k, v]) => attrs?.[k] === v);
    });
  }
}

class InMemoryRelationStore implements RelationStore {
  rows = new Map<string, Relation<unknown>>();
  private k(t: string, e: string, f: string, to: string): string {
    return `${t}::${e}::${f}::${to}`;
  }
  async add<TAttrs = unknown>(
    input: RelationWriteInput<TAttrs>,
  ): Promise<Relation<TAttrs>> {
    const key = this.k(input.tenantId, input.edgeType, input.fromId, input.toId);
    const row: Relation<TAttrs> = {
      tenantId: input.tenantId,
      edgeType: input.edgeType,
      fromId: input.fromId,
      toId: input.toId,
      attrs: input.attrs ?? null,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(key, row as Relation<unknown>);
    return row;
  }
  async remove(t: string, e: string, f: string, to: string): Promise<void> {
    this.rows.delete(this.k(t, e, f, to));
  }
  async outgoing<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    fromId: string,
  ): Promise<Relation<TAttrs>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.edgeType === edgeType && r.fromId === fromId,
    ) as Relation<TAttrs>[];
  }
  async incoming<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    toId: string,
  ): Promise<Relation<TAttrs>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.edgeType === edgeType && r.toId === toId,
    ) as Relation<TAttrs>[];
  }
}

interface Fixture {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  tenantId: string;
}

function newFixture(): Fixture {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    relations: new InMemoryRelationStore(),
    tenantId: 't1',
  };
}

async function dispatchAll(fx: Fixture): Promise<void> {
  for (const e of fx.events.events) {
    await dispatchIdentityEvent(e, {
      entities: fx.entities,
      relations: fx.relations,
    });
  }
}

describe('Identity.User.Create', () => {
  it('emits UserCreated with platform + tenant cache tags', async () => {
    const fx = newFixture();
    const result = await handleUserCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        principalId: 'admin-1',
        email: 'Alice@Example.com',
        primaryIdpSubject: 'sub-alice',
      },
      fx.events,
    );
    expect(result.envelope.eventType).toBe('Identity.UserCreated');
    expect(result.envelope.cacheInvalidationTags).toContain('Tenant:t1');
    // Email is normalized to lowercase.
    expect(result.document.email).toBe('alice@example.com');
    expect(result.document.primaryIdpSubject).toBe('sub-alice');
  });

  it('dispatcher persists to platform partition', async () => {
    const fx = newFixture();
    const result = await handleUserCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'p',
        email: 'bob@example.com',
      },
      fx.events,
    );
    await dispatchAll(fx);
    const stored = await getUserEntity(
      fx.entities,
      fx.tenantId,
      result.document.userId,
    );
    expect(stored?.email).toBe('bob@example.com');
  });
});

describe('Identity.Membership.Create', () => {
  it('refuses when user does not exist', async () => {
    const fx = newFixture();
    await expect(
      handleMembershipCreate(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'p',
          userId: 'usr-nonexistent',
          roles: ['Author'],
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.USER_NOT_FOUND });
  });

  it('writes membership + relation edge through dispatcher', async () => {
    const fx = newFixture();
    const userResult = await handleUserCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'p',
        email: 'alice@example.com',
      },
      fx.events,
    );
    await dispatchAll(fx);

    await handleMembershipCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'p',
        userId: userResult.document.userId,
        roles: ['TenantAdmin'],
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    const m = await getMembershipEntity(
      fx.entities,
      fx.tenantId,
      userResult.document.userId,
    );
    expect(m?.roles).toEqual(['TenantAdmin']);

    // membership.user edge present, pointing at the same-tenant user row.
    const edges = await fx.relations.outgoing(
      fx.tenantId,
      'membership.user',
      `m:${userResult.document.userId}`,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]?.toId).toBe(userResult.document.userId);
  });

  it('refuses duplicate membership for same (tenant, user)', async () => {
    const fx = newFixture();
    const userResult = await handleUserCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'p',
        email: 'alice@example.com',
      },
      fx.events,
    );
    await dispatchAll(fx);
    await handleMembershipCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'p',
        userId: userResult.document.userId,
        roles: ['Viewer'],
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await expect(
      handleMembershipCreate(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'p',
          userId: userResult.document.userId,
          roles: ['Author'],
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});

describe('Identity.Invite.Issue + Accept', () => {
  it('issues a token, accepts it, and creates User + Membership', async () => {
    const fx = newFixture();
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'charlie@example.com',
        rolesOnAccept: ['Author'],
      },
      fx.events,
    );
    expect(issued.plaintextToken.length).toBeGreaterThan(20);
    expect(issued.document.tokenHash).toBe(hashSecret(issued.plaintextToken));
    expect(issued.document.tokenLookup).toBe(lookupOf(issued.plaintextToken));
    await dispatchAll(fx);

    // Persisted invite is in pending.
    const stored = await getInviteTokenEntity(
      fx.entities,
      fx.tenantId,
      issued.document.tokenId,
    );
    expect(stored?.status).toBe('pending');

    const accept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: issued.plaintextToken,
        primaryIdpSubject: 'sub-charlie',
      },
      fx.events,
      fx.entities,
    );
    expect(accept.envelope.eventType).toBe('Identity.InviteAccepted');
    // Two follow events: UserCreated + MembershipCreated.
    expect(accept.follow.map((e) => e.eventType)).toEqual([
      'Identity.UserCreated',
      'Identity.MembershipCreated',
    ]);

    await dispatchAll(fx);

    // Invite flipped to accepted.
    const acceptedInvite = await getInviteTokenEntity(
      fx.entities,
      fx.tenantId,
      issued.document.tokenId,
    );
    expect(acceptedInvite?.status).toBe('accepted');
    expect(acceptedInvite?.acceptedUserId).toBe(accept.user.userId);

    // User exists in tenant partition.
    const user = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
    expect(user?.email).toBe('charlie@example.com');
    expect(user?.primaryIdpSubject).toBe('sub-charlie');

    // Membership minted with invite's roles.
    const membership = await getMembershipEntity(
      fx.entities,
      fx.tenantId,
      accept.user.userId,
    );
    expect(membership?.roles).toEqual(['Author']);
  });

  it('rejects bogus token', async () => {
    const fx = newFixture();
    await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'dave@example.com',
        rolesOnAccept: ['Viewer'],
      },
      fx.events,
    );
    await dispatchAll(fx);
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: 'not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaa',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.INVITE_NOT_FOUND });
  });

  it('rejects expired token', async () => {
    const fx = newFixture();
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'eve@example.com',
        rolesOnAccept: ['Viewer'],
        ttlSeconds: -1, // already expired
      },
      fx.events,
    );
    await dispatchAll(fx);
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: issued.plaintextToken,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.INVITE_EXPIRED });
  });

  it('reuses existing user when invite email matches', async () => {
    const fx = newFixture();
    const userResult = await handleUserCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'frank@example.com',
      },
      fx.events,
    );
    await dispatchAll(fx);
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'frank@example.com',
        rolesOnAccept: ['Author'],
      },
      fx.events,
    );
    await dispatchAll(fx);
    const accept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: issued.plaintextToken,
      },
      fx.events,
      fx.entities,
    );
    expect(accept.user.userId).toBe(userResult.document.userId);
    // No follow-up UserCreated when reusing.
    expect(accept.follow.map((e) => e.eventType)).toEqual([
      'Identity.MembershipCreated',
    ]);
  });
});

describe('I12 — projections rebuild from event history alone', () => {
  it('replaying the full event log reproduces the post-state', async () => {
    const fx = newFixture();
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'rebuild@example.com',
        rolesOnAccept: ['TenantAdmin'],
      },
      fx.events,
    );
    await dispatchAll(fx);
    await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: issued.plaintextToken,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    // Snapshot post-state.
    const before = JSON.stringify({
      entities: Array.from(fx.entities.rows.entries()).sort(),
      relations: Array.from(fx.relations.rows.entries()).sort(),
    });

    // Wipe projections, replay events through dispatcher only.
    fx.entities.rows.clear();
    fx.relations.rows.clear();
    await dispatchAll(fx);

    const after = JSON.stringify({
      entities: Array.from(fx.entities.rows.entries()).sort(),
      relations: Array.from(fx.relations.rows.entries()).sort(),
    });

    // The dispatcher stamps `updatedAt` / `createdAt` from `Date.now()`
    // on each put — replay timestamps drift by a few ms. We care that
    // the *shape* (entities by id, edges by id, attrs payload) is
    // identical, not the wall-clock fields. Strip volatile timestamps
    // before comparing.
    function strip(s: string): string {
      return s
        .replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"<t>"')
        .replace(/"createdAt":"[^"]+"/g, '"createdAt":"<t>"');
    }
    expect(strip(before)).toBe(strip(after));

    // Sanity: the rebuilt user is reachable and has the right email.
    const rebuiltUsers = await fx.entities.list<UserDocument>(
      fx.tenantId,
      'User',
    );
    expect(rebuiltUsers.map((u) => u.attrs.email)).toContain(
      'rebuild@example.com',
    );
  });
});
