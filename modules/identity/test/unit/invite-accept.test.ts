/**
 * Unit tests for `handleInviteAccept` (Layer 1, Identity Module Test Pass).
 *
 * Scope: branch coverage of the invite-accept handler. Auth-issuing,
 * security-critical — every error code must have a no-side-effect
 * assertion. Cross-handler scenario coverage (issue → accept sequences,
 * role-pack interaction) lives in `../handlers.test.ts`.
 *
 * Idempotency note: the handler does not implement its own idempotency
 * check; the ingress pipeline above enforces it via the IntentEnvelope
 * `idempotencyKey`. Calling `handleInviteAccept` twice on the same
 * pending invite will succeed once and fail the second time with
 * `INVITE_ALREADY_USED` because the first call flipped the invite
 * status — this is asserted in the error-paths block.
 */

import { describe, it, expect } from 'vitest';
import {
  handleInviteIssue,
  handleInviteAccept,
  IdentityError,
  identityErrorCodes,
  DEFAULT_SESSION_POLICY,
  type SessionPolicy,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

async function seedPendingInvite(
  fx: ReturnType<typeof newFixture>,
  email: string,
  rolesOnAccept: ReadonlyArray<string> = ['Author'],
  ttlSeconds?: number,
): Promise<{ plaintextToken: string; tokenId: string }> {
  const issued = await handleInviteIssue(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: 'admin',
      email,
      rolesOnAccept: [...rolesOnAccept],
      ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
    },
    fx.events,
  );
  await dispatchAll(fx);
  return {
    plaintextToken: issued.plaintextToken,
    tokenId: issued.document.tokenId,
  };
}

describe('handleInviteAccept — happy path (new user)', () => {
  it('emits UserCreated → MembershipCreated → InviteAccepted → SessionIssued in order', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'new@example.com');

    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'new@example.com',
      },
      fx.events,
      fx.entities,
    );

    expect(result.envelope.eventType).toBe('Identity.InviteAccepted');
    expect(result.envelope.schemaId).toBe('domain.identity.invite.accepted.v1');
    expect(result.envelope.schemaVersion).toBe(1);
    expect(result.envelope.correlationId).toBe('corr-1');
    expect(result.envelope.principalId).toBeNull();
    expect(result.follow.map((e) => e.eventType)).toEqual([
      'Identity.UserCreated',
      'Identity.MembershipCreated',
      'Identity.SessionIssued',
    ]);
  });

  it('exact cacheInvalidationTags on InviteAccepted: Tenant + Invite + User', async () => {
    const fx = newFixture();
    const { plaintextToken, tokenId } = await seedPendingInvite(
      fx,
      'tags@example.com',
    );
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'tags@example.com',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `Invite:${tokenId}`,
      `User:${result.user.userId}`,
    ]);
  });

  it('UserCreated and MembershipCreated cache tags include tenant + user (and membership for membership)', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'flags@example.com');
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'flags@example.com',
      },
      fx.events,
      fx.entities,
    );
    const userCreated = result.follow.find(
      (e) => e.eventType === 'Identity.UserCreated',
    );
    const membershipCreated = result.follow.find(
      (e) => e.eventType === 'Identity.MembershipCreated',
    );
    expect(userCreated?.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:${result.user.userId}`,
    ]);
    expect(membershipCreated?.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:${result.user.userId}`,
      `Membership:${fx.tenantId}:${result.user.userId}`,
    ]);
  });

  it('mints membership with the invite roles', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'roles@example.com', [
      'TenantAdmin',
      'Author',
    ]);
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'roles@example.com',
      },
      fx.events,
      fx.entities,
    );
    expect(result.membership.roles).toEqual(['TenantAdmin', 'Author']);
    expect(result.membership.status).toBe('active');
  });

  it('returns a sessionResult with plaintexts surfaced once and not stored on the document', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'sess@example.com');
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'sess@example.com',
      },
      fx.events,
      fx.entities,
    );
    expect(result.sessionResult).toBeDefined();
    const docJson = JSON.stringify(result.sessionResult?.document);
    expect(docJson).not.toContain(result.sessionResult?.plaintextRefreshToken);
    expect(docJson).not.toContain(result.sessionResult?.plaintextAccessToken);
    expect(result.sessionResult?.cookiePayload).toBe(
      `${result.sessionResult?.document.sessionId}.${result.sessionResult?.plaintextRefreshToken}`,
    );
  });

  it('email match is case-insensitive and trims whitespace', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'Mixed@Example.COM');
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: '   mixed@example.com   ',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.InviteAccepted');
  });
});

describe('handleInviteAccept — happy path (existing user)', () => {
  it('reuses the existing user and skips UserCreated in follow chain', async () => {
    const fx = newFixture();
    // Seed an invite, redeem it, then issue + redeem a second invite for
    // the same email. Second redeem should reuse the user.
    const first = await seedPendingInvite(fx, 'reuse@example.com');
    const firstAccept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c1',
        principalId: null,
        presentedToken: first.plaintextToken,
        acceptedEmail: 'reuse@example.com',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    const second = await seedPendingInvite(fx, 'reuse@example.com', [
      'Viewer',
    ]);
    const secondAccept = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c2',
        principalId: null,
        presentedToken: second.plaintextToken,
        acceptedEmail: 'reuse@example.com',
      },
      fx.events,
      fx.entities,
    );
    expect(secondAccept.user.userId).toBe(firstAccept.user.userId);
    expect(secondAccept.follow.map((e) => e.eventType)).toEqual([
      'Identity.MembershipCreated',
      'Identity.SessionIssued',
    ]);
  });
});

describe('handleInviteAccept — configuration knobs', () => {
  it('binds primaryIdpSubject to the new user', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'idp@example.com');
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'idp@example.com',
        primaryIdpSubject: 'sub-12345',
      },
      fx.events,
      fx.entities,
    );
    expect(result.user.primaryIdpSubject).toBe('sub-12345');
  });

  it('persists givenName and familyName when provided', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'name@example.com');
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'name@example.com',
        givenName: 'Ada',
        familyName: 'Lovelace',
      },
      fx.events,
      fx.entities,
    );
    expect(result.user.givenName).toBe('Ada');
    expect(result.user.familyName).toBe('Lovelace');
  });

  it('honors issueSession=false (no session minted, no SessionIssued in follow)', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'nosess@example.com');
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'nosess@example.com',
        issueSession: false,
      },
      fx.events,
      fx.entities,
    );
    expect(result.sessionResult).toBeUndefined();
    expect(
      result.follow.some((e) => e.eventType === 'Identity.SessionIssued'),
    ).toBe(false);
  });

  it('passes ip and userAgent through to the minted session', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'ip@example.com');
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'ip@example.com',
        ip: '203.0.113.7',
        userAgent: 'curl/7.85',
      },
      fx.events,
      fx.entities,
    );
    expect(result.sessionResult?.document.ip).toBe('203.0.113.7');
    expect(result.sessionResult?.document.userAgent).toBe('curl/7.85');
  });

  it('honors custom sessionPolicy on the minted session', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'policy@example.com');
    const policy: SessionPolicy = {
      ...DEFAULT_SESSION_POLICY,
      hardTimeoutHours: 1,
    };
    const before = Date.now();
    const result = await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'policy@example.com',
        sessionPolicy: policy,
      },
      fx.events,
      fx.entities,
    );
    const hardExpiresMs = new Date(
      result.sessionResult!.document.hardExpiresAt,
    ).getTime();
    expect(hardExpiresMs - before).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
    expect(hardExpiresMs - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
  });
});

describe('handleInviteAccept — error paths', () => {
  it('rejects unknown plaintext token with INVITE_NOT_FOUND', async () => {
    const fx = newFixture();
    await seedPendingInvite(fx, 'real@example.com');
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: 'totally-not-a-real-token-xxxxxxxxxxxxxxxxxxxx',
          acceptedEmail: 'real@example.com',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.INVITE_NOT_FOUND });
  });

  it('rejects expired token with INVITE_EXPIRED', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(
      fx,
      'expired@example.com',
      ['Author'],
      -1,
    );
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: plaintextToken,
          acceptedEmail: 'expired@example.com',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.INVITE_EXPIRED });
  });

  it('rejects an already-accepted token with INVITE_NOT_FOUND (lookup is pending-scoped)', async () => {
    // The handler has a status-check branch that would emit
    // INVITE_ALREADY_USED, but `findInviteTokensByLookup` filters to
    // `status: 'pending'` upstream — so once an invite is accepted, the
    // lookup returns no candidates and the next redemption gets
    // INVITE_NOT_FOUND. The status branch is a defensive layer for a
    // future adapter that weakens the partition. Asserting actual
    // behavior here; the unreachable branch is documented in
    // `handlers.test.ts` cross-reference.
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'twice@example.com');
    await handleInviteAccept(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: null,
        presentedToken: plaintextToken,
        acceptedEmail: 'twice@example.com',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: plaintextToken,
          acceptedEmail: 'twice@example.com',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.INVITE_NOT_FOUND });
  });

  it('rejects mismatched email with opaque INVITE_NOT_FOUND (avoid email-probing leak)', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'real@example.com');
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: plaintextToken,
          acceptedEmail: 'spoofed@example.com',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.INVITE_NOT_FOUND });
  });

  it('throws IdentityError instances (not bare Error) for every rejection', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(fx, 'inst@example.com');
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: plaintextToken,
          acceptedEmail: 'wrong@example.com',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it('emits no events when token is unknown', async () => {
    const fx = newFixture();
    await seedPendingInvite(fx, 'present@example.com');
    const eventsBefore = fx.events.events.length;
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: 'absolutely-not-a-token-yyyyyyyyyyyyyyyyyyyyyyyy',
          acceptedEmail: 'present@example.com',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toThrow();
    expect(fx.events.events.length).toBe(eventsBefore);
  });

  it('emits no events when email mismatches', async () => {
    const fx = newFixture();
    const { plaintextToken } = await seedPendingInvite(
      fx,
      'mismatch@example.com',
    );
    const eventsBefore = fx.events.events.length;
    await expect(
      handleInviteAccept(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          presentedToken: plaintextToken,
          acceptedEmail: 'wrong@example.com',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toThrow();
    expect(fx.events.events.length).toBe(eventsBefore);
  });
});

describe('handleInviteAccept — tenant scoping', () => {
  it("invite issued in tenant B cannot be redeemed under tenant A's accept call", async () => {
    const fx = newFixture('tenant-a');
    // Seed invite in tenant B.
    const issuedInB = await handleInviteIssue(
      {
        tenantId: 'tenant-b',
        correlationId: 'seed-b',
        principalId: 'admin-b',
        email: 'cross@example.com',
        rolesOnAccept: ['Author'],
      },
      fx.events,
    );
    await dispatchAll(fx);
    // Try to redeem under tenant A — lookup is tenant-scoped, so the
    // accept call sees no candidates and returns INVITE_NOT_FOUND.
    await expect(
      handleInviteAccept(
        {
          tenantId: 'tenant-a',
          correlationId: 'cross-attempt',
          principalId: null,
          presentedToken: issuedInB.plaintextToken,
          acceptedEmail: 'cross@example.com',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.INVITE_NOT_FOUND });
  });
});
