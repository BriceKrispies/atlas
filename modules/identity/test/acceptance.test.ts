/**
 * Phase A1 acceptance — end-to-end integration tests.
 *
 * Covers the `@phase-a1`-tagged scenarios from:
 *   - specs/domains/identity/features/password/password.feature
 *   - specs/domains/identity/features/magic-link/magic-link.feature
 *   - specs/domains/identity/features/platform-oidc/platform-oidc.feature
 *
 * Each `it(...)` cites the Gherkin scenario it implements. Updates to a
 * scenario should land here in lockstep so the @phase-a1 set stays
 * truthful.
 *
 * Out-of-scope (`@phase-a2` / `@phase-a3` tagged scenarios) live as
 * `it.todo` placeholders below — they fail-soft so adding them later
 * is a one-line edit, not a new file scaffold.
 *
 * The Playwright BDD harness picks these features up once the sim
 * wires identity (browser-compatible argon2 dep + AuthSession entity
 * land in Phase A2). Until then, vitest covers the same surface.
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
  handleInviteIssue,
  handleInviteAccept,
  handlePasswordSet,
  handlePasswordLogin,
  identityDispatcher,
  getUserEntity,
  getMembershipEntity,
  getInviteTokenEntity,
  buildRolePackBundle,
  identityErrorCodes,
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

interface AcceptanceFixture {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  tenantId: string;
  /** Replay the entire event log through the dispatcher. */
  drain(): Promise<void>;
}

function newFixture(tenantId = 'acme'): AcceptanceFixture {
  const events = new InMemoryEventStore();
  const entities = new InMemoryEntityStore();
  const relations = new InMemoryRelationStore();
  return {
    events,
    entities,
    relations,
    tenantId,
    async drain() {
      const dispatch = identityDispatcher({ entities, relations });
      for (const e of events.events) {
        await dispatch(e);
      }
    },
  };
}

// =====================================================================
// platform-oidc.feature — @phase-a1 scenarios
// =====================================================================

describe('platform-oidc.feature: First-admin bootstrap mints an InviteToken', () => {
  it('atlasctl tenant add-admin path: InviteToken in pending, no Membership yet', async () => {
    const fx = newFixture('acme');
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'boot-corr',
        principalId: '_atlasctl_bootstrap',
        email: 'admin@example.com',
        rolesOnAccept: ['TenantAdmin'],
      },
      fx.events,
    );
    await fx.drain();

    expect(issued.plaintextToken.length).toBeGreaterThan(20);
    const stored = await getInviteTokenEntity(
      fx.entities,
      fx.tenantId,
      issued.document.tokenId,
    );
    expect(stored?.status).toBe('pending');
    expect(stored?.email).toBe('admin@example.com');
    expect(stored?.rolesOnAccept).toEqual(['TenantAdmin']);
    // No Membership yet — that lands on accept.
    const memberships = await fx.entities.list(fx.tenantId, 'Membership');
    expect(memberships).toHaveLength(0);
  });
});

describe('platform-oidc.feature: Invitee completes first login', () => {
  it('accept flow creates User + Membership, flips InviteToken to accepted', async () => {
    const fx = newFixture('acme');
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'boot-corr',
        principalId: '_atlasctl_bootstrap',
        email: 'admin@example.com',
        rolesOnAccept: ['TenantAdmin'],
      },
      fx.events,
    );
    await fx.drain();

    const accept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-accept-1',
        principalId: null,
        presentedToken: issued.plaintextToken,
        primaryIdpSubject: 'sub-admin-from-jwt',
      },
      fx.events,
      fx.entities,
    );
    await fx.drain();

    // User entity has primaryIdpSubject from the JWT.
    const user = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
    expect(user?.email).toBe('admin@example.com');
    expect(user?.primaryIdpSubject).toBe('sub-admin-from-jwt');

    // Membership has the role from the InviteToken.
    const membership = await getMembershipEntity(
      fx.entities,
      fx.tenantId,
      accept.user.userId,
    );
    expect(membership?.roles).toEqual(['TenantAdmin']);

    // InviteToken flipped to accepted.
    const acceptedInvite = await getInviteTokenEntity(
      fx.entities,
      fx.tenantId,
      issued.document.tokenId,
    );
    expect(acceptedInvite?.status).toBe('accepted');

    // UserCreated + MembershipCreated events emitted with the request correlationId.
    const userCreated = fx.events.events.find(
      (e) => e.eventType === 'Identity.UserCreated' && e.correlationId === 'corr-accept-1',
    );
    const membershipCreated = fx.events.events.find(
      (e) =>
        e.eventType === 'Identity.MembershipCreated' && e.correlationId === 'corr-accept-1',
    );
    expect(userCreated).toBeTruthy();
    expect(membershipCreated).toBeTruthy();
  });
});

describe('platform-oidc.feature: Returning user — Phase A1 portion', () => {
  // The full scenario also asserts AuthSession creation (Phase A2); the
  // Phase A1 portion is principal-resolution by primaryIdpSubject.
  it('user resolved by primaryIdpSubject; roles hydrate from Membership', async () => {
    const fx = newFixture('acme');
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c1',
        principalId: '_boot',
        email: 'alice@acme.com',
        rolesOnAccept: ['Author'],
      },
      fx.events,
    );
    await fx.drain();
    await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c2',
        principalId: null,
        presentedToken: issued.plaintextToken,
        primaryIdpSubject: 'sub-alice',
      },
      fx.events,
      fx.entities,
    );
    await fx.drain();

    // Simulate principal middleware lookup-by-IDP-subject.
    const { findUserByIdpSubject } = await import('../src/index.ts');
    const found = await findUserByIdpSubject(fx.entities, fx.tenantId, 'sub-alice');
    expect(found?.email).toBe('alice@acme.com');
    if (!found) throw new Error('user must exist');
    const membership = await getMembershipEntity(fx.entities, fx.tenantId, found.userId);
    expect(membership?.roles).toEqual(['Author']);
  });
});

// =====================================================================
// password.feature — @phase-a1 scenarios
// =====================================================================

describe('password.feature: User sets initial password from invite', () => {
  it('end-to-end: invite → accept → set-password lands an Argon2id hash', async () => {
    const fx = newFixture('smb');

    // Invite issued (atlasctl).
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-issue',
        principalId: '_boot',
        email: 'alice@smb.com',
        rolesOnAccept: ['TenantAdmin'],
      },
      fx.events,
    );
    await fx.drain();

    // Accept (creates User + Membership).
    const accept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-accept',
        principalId: null,
        presentedToken: issued.plaintextToken,
      },
      fx.events,
      fx.entities,
    );
    await fx.drain();

    // SetPassword (separate intent — Phase A1 ships /api/v1/intents
    // path; the magic-link-then-set-password UI flow lands as a route
    // pair in Phase A2).
    const setResult = await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-set',
        principalId: accept.user.userId,
        userId: accept.user.userId,
        newPassword: 'P@ssw0rd-2026!',
      },
      fx.events,
      fx.entities,
    );
    await fx.drain();

    // User.attrs.passwordHash is Argon2id-shaped.
    const user = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);

    // PasswordChanged event emitted (without plaintext). JSON.stringify
    // would trip on the bigint `seq` field; serialize with a replacer
    // that coerces bigints to strings.
    expect(setResult.envelope.eventType).toBe('Identity.PasswordChanged');
    const payload = setResult.envelope.payload as Record<string, unknown>;
    const doc = payload['document'] as Record<string, unknown>;
    expect(doc['passwordHash']).toMatch(/^\$argon2id\$/);
    const serialized = JSON.stringify(setResult.envelope, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(serialized).not.toContain('P@ssw0rd-2026!');

    // InviteToken accepted, Membership has the right role.
    const invite = await getInviteTokenEntity(fx.entities, fx.tenantId, issued.document.tokenId);
    expect(invite?.status).toBe('accepted');
    const membership = await getMembershipEntity(fx.entities, fx.tenantId, accept.user.userId);
    expect(membership?.roles).toEqual(['TenantAdmin']);
  });
});

describe('password.feature: Account lockout after sustained failures', () => {
  it('5 wrong attempts within 1 hour set lockedUntil and emit AccountLocked', async () => {
    const fx = newFixture('smb');

    // Bootstrap a user with a password.
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-i',
        principalId: '_boot',
        email: 'alice@smb.com',
        rolesOnAccept: ['Author'],
      },
      fx.events,
    );
    await fx.drain();
    const accept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-a',
        principalId: null,
        presentedToken: issued.plaintextToken,
      },
      fx.events,
      fx.entities,
    );
    await fx.drain();
    await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-s',
        principalId: accept.user.userId,
        userId: accept.user.userId,
        newPassword: 'correct-horse-Battery-staple',
      },
      fx.events,
      fx.entities,
    );
    await fx.drain();

    // Five wrong attempts.
    for (let i = 0; i < 5; i += 1) {
      await handlePasswordLogin(
        {
          tenantId: fx.tenantId,
          correlationId: `c-l-${i}`,
          email: 'alice@smb.com',
          password: 'wrong-Password-12345',
        },
        fx.events,
        fx.entities,
      );
      await fx.drain();
    }

    // lockedUntil ~15 minutes in the future.
    const user = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
    expect(user?.lockedUntil).toBeTruthy();
    if (!user?.lockedUntil) throw new Error('lockedUntil missing');
    const lockedDelta = new Date(user.lockedUntil).getTime() - Date.now();
    expect(lockedDelta).toBeGreaterThan(14 * 60 * 1000);
    expect(lockedDelta).toBeLessThan(16 * 60 * 1000);

    // AccountLocked event emitted.
    const lockedEvents = fx.events.events.filter(
      (e) => e.eventType === 'Identity.AccountLocked',
    );
    expect(lockedEvents.length).toBeGreaterThanOrEqual(1);

    // Further attempts (even with right password) rejected with reason="account_locked".
    const blocked = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-blocked',
        email: 'alice@smb.com',
        password: 'correct-horse-Battery-staple',
      },
      fx.events,
      fx.entities,
    );
    expect((blocked.envelope.payload as Record<string, unknown>)['reason']).toBe(
      'account_locked',
    );
  });
});

describe('password.feature: Password complexity rejected at set-time', () => {
  it('weak password produces PASSWORD_COMPLEXITY error, no entity mutated', async () => {
    const fx = newFixture('smb');

    // Seed a user.
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: '_boot',
        email: 'alice@smb.com',
        rolesOnAccept: ['Author'],
      },
      fx.events,
    );
    await fx.drain();
    const accept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c2',
        principalId: null,
        presentedToken: issued.plaintextToken,
      },
      fx.events,
      fx.entities,
    );
    await fx.drain();

    const userBefore = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
    const eventCountBefore = fx.events.events.length;

    await expect(
      handlePasswordSet(
        {
          tenantId: fx.tenantId,
          correlationId: 'c-set',
          principalId: accept.user.userId,
          userId: accept.user.userId,
          newPassword: 'abc',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.PASSWORD_COMPLEXITY,
      status: 400,
    });

    const userAfter = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
    expect(userAfter).toEqual(userBefore);
    expect(fx.events.events.length).toBe(eventCountBefore);
  });
});

// =====================================================================
// magic-link.feature — @phase-a1 scenarios
// =====================================================================

describe('magic-link.feature: First-admin bootstrap (atlasctl)', () => {
  it('atlasctl-equivalent flow: invite issued, then accept creates User+Membership', async () => {
    const fx = newFixture('scribe');

    // The atlasctl script calls handleInviteIssue + identityDispatcher
    // — same path as this test.
    const issued = await handleInviteIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-boot',
        principalId: '_atlasctl_bootstrap',
        email: 'admin@scribe.com',
        rolesOnAccept: ['TenantAdmin'],
      },
      fx.events,
    );
    await fx.drain();

    // The plaintext token is what would be printed to operator stdout.
    expect(issued.plaintextToken).toBeTruthy();

    // On click — invite-accept route (which we have in
    // `apps/server/src/routes/identity.ts`).
    const accept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-click',
        principalId: null,
        presentedToken: issued.plaintextToken,
        primaryIdpSubject: 'sub-from-platform-oidc',
      },
      fx.events,
      fx.entities,
    );
    await fx.drain();

    expect(accept.user.email).toBe('admin@scribe.com');
    expect(accept.membership.roles).toEqual(['TenantAdmin']);
  });
});

// =====================================================================
// Role packs — they're the third leg of "Phase A1 acceptance" since
// without them the role names hydrated above are decorative.
// =====================================================================

describe('role packs (cross-cutting)', () => {
  it('TenantAdmin permit covers every action emitted from the bundled manifests', () => {
    const bundle = buildRolePackBundle([
      { actionId: 'ContentPages.Page.Create', resourceType: 'Page', verb: 'create' },
      { actionId: 'ContentPages.Page.Search', resourceType: 'Page', verb: 'search' },
      { actionId: 'Catalog.Family.Publish', resourceType: 'Family', verb: 'publish' },
      // intentionally use the schema generator's expected shape; the
      // platform default seed reads moduleManifests() at runtime.
    ] as never);
    expect(bundle.format).toBe('cedar-text');
    expect(bundle.policies).toContain('@id("role-tenant-admin")');
    expect(bundle.policies).toContain('Action::"ContentPages.Page.Create"');
    expect(bundle.policies).toContain('Action::"Catalog.Family.Publish"');
    // Viewer's permit excludes the write actions.
    const viewerBlock =
      bundle.policies.split('@id("role-viewer")')[1]?.split('@id("role-service-principal")')[0] ?? '';
    expect(viewerBlock).toContain('Action::"ContentPages.Page.Search"');
    expect(viewerBlock).not.toContain('Action::"ContentPages.Page.Create"');
  });
});

// =====================================================================
// @phase-a2 scenarios — placeholder so future progress is trackable.
// =====================================================================

describe('@phase-a2 scenarios (deferred)', () => {
  it.todo('password.feature: Successful password login (AuthSession + cookie)');
  it.todo('password.feature: Wrong password — rate limited');
  it.todo('password.feature: Forgot-password flow (ResetToken + email)');
  it.todo('password.feature: Reset password using a valid token');
  it.todo('password.feature: Reject reset with expired token');
  it.todo('magic-link.feature: User requests a magic link (MagicLinkToken + email)');
  it.todo('magic-link.feature: Magic-link click logs the user in');
  it.todo('magic-link.feature: Reject expired magic link');
  it.todo('magic-link.feature: Reject reused magic link');
  it.todo('magic-link.feature: Throttle repeated requests');
  it.todo('magic-link.feature: Email-not-found does not leak account existence');
  it.todo('platform-oidc.feature: User without Membership is rejected (403)');
  it.todo('platform-oidc.feature: Suspended Membership blocks login (403)');
  it.todo('platform-oidc.feature: Returning user — AuthSession creation half');
});
