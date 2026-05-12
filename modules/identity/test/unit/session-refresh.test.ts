/**
 * Unit tests for `handleSessionRefresh` (Layer 1).
 *
 * The existing `../session.test.ts` already covers rotation, the
 * grace-window read, hard- and idle-timeout, the `previousRefreshTokenHash`
 * reuse path, and the unknown-sessionId path. This file adds the
 * branch-coverage gaps:
 *
 *   - Envelope shape + exact `cacheInvalidationTags` for SessionRefreshed.
 *   - Refresh against a `revoked` session → `SESSION_REVOKED`.
 *   - Refresh against an `evicted` session → `SESSION_EXPIRED`.
 *   - Reuse via the `revokedRefreshTokenHashes` ring (a stolen token
 *     replayed two or more rotations later — distinct branch from
 *     previousRefreshTokenHash).
 *   - Defensive tenant cross-check (rare, but covered).
 *   - Ring cap (revokedRefreshTokenHashes capped at 16).
 */

import { describe, it, expect } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import {
  handleSessionIssue,
  handleSessionRefresh,
  handleSessionRevoke,
  IdentityError,
  identityErrorCodes,
  type AuthSessionDocument,
  DEFAULT_SESSION_POLICY,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

async function issue(
  fx: ReturnType<typeof newFixture>,
  userId = 'user-1',
): Promise<{
  sessionId: string;
  refreshSecret: string;
}> {
  const result = await handleSessionIssue(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: userId,
      userId,
    },
    fx.events,
    fx.entities,
  );
  await dispatchAll(fx);
  return {
    sessionId: result.document.sessionId,
    refreshSecret: result.plaintextRefreshToken,
  };
}

describe('handleSessionRefresh — happy path envelope shape', () => {
  it('emits Identity.SessionRefreshed with the documented envelope', async () => {
    const fx = newFixture();
    const { sessionId, refreshSecret } = await issue(fx);
    const result = await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        sessionId,
        presentedRefreshSecret: refreshSecret,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.SessionRefreshed');
    expect(result.envelope.schemaId).toBe(
      'domain.identity.session.refreshed.v1',
    );
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:user-1`,
      `Session:${sessionId}`,
    ]);
    expect(result.document?.sessionId).toBe(sessionId);
    expect(result.document?.previousRefreshTokenHash).toBeDefined();
  });

  it('returns new plaintexts and cookiePayload formatted as <sessionId>.<refreshSecret>', async () => {
    const fx = newFixture();
    const { sessionId, refreshSecret } = await issue(fx);
    const result = await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        sessionId,
        presentedRefreshSecret: refreshSecret,
      },
      fx.events,
      fx.entities,
    );
    expect(result.plaintextRefreshToken).toBeDefined();
    expect(result.plaintextRefreshToken).not.toBe(refreshSecret);
    expect(result.cookiePayload).toBe(
      `${sessionId}.${result.plaintextRefreshToken}`,
    );
  });
});

describe('handleSessionRefresh — error paths not covered by session.test.ts', () => {
  it('rejects refresh on a revoked session with SESSION_REVOKED', async () => {
    const fx = newFixture();
    const { sessionId, refreshSecret } = await issue(fx);
    await handleSessionRevoke(
      {
        tenantId: fx.tenantId,
        correlationId: 'rev',
        sessionId,
        principalId: 'user-1',
        reason: 'manual_revoke',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await expect(
      handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          sessionId,
          presentedRefreshSecret: refreshSecret,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_REVOKED });
  });

  it('rejects refresh on an evicted session with SESSION_EXPIRED', async () => {
    const fx = newFixture();
    const { sessionId, refreshSecret } = await issue(fx);
    // Manually flip the persisted entity to evicted.
    const row = await fx.entities.get<AuthSessionDocument>(
      fx.tenantId,
      'AuthSession',
      sessionId,
    );
    if (!row) throw new Error('test setup');
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'AuthSession',
      entityId: sessionId,
      attrs: { ...row.attrs, status: 'evicted' },
    });
    await expect(
      handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          sessionId,
          presentedRefreshSecret: refreshSecret,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_EXPIRED });
  });

  it('reuse-detection via revokedRefreshTokenHashes ring trips after two rotations + replay', async () => {
    const fx = newFixture();
    const { sessionId, refreshSecret: r0 } = await issue(fx);

    // Rotate twice. After two rotations, r0 should be in the
    // revokedRefreshTokenHashes ring (current → previous → revoked).
    const r1Result = await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'rot1',
        sessionId,
        presentedRefreshSecret: r0,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const r1 = assertDefined(
      r1Result.plaintextRefreshToken,
      'rotation result always carries the new plaintext refresh token',
    );

    await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'rot2',
        sessionId,
        presentedRefreshSecret: r1,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    // Replay r0 — it's now in the revoked ring, distinct from
    // previousRefreshTokenHash. Triggers SESSION_REUSE_DETECTED.
    const before = fx.events.events.length;
    await expect(
      handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'replay',
          sessionId,
          presentedRefreshSecret: r0,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_REUSE_DETECTED });
    // Reuse-detection emits SessionAnomaly + SessionEnded(s) BEFORE the
    // throw — assert events landed.
    expect(fx.events.events.length).toBeGreaterThan(before);
    const anomaly = fx.events.events.find(
      (e) => e.eventType === 'Identity.SessionAnomaly',
    );
    expect(anomaly).toBeDefined();
  });

  it('throws IdentityError instances (not bare Error) for every rejection', async () => {
    const fx = newFixture();
    await expect(
      handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          sessionId: 'sess-fake',
          presentedRefreshSecret: 'whatever',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});

describe('handleSessionRefresh — defensive tenant cross-check', () => {
  it('session in tenant B is invisible to refresh under tenant A (defensive)', async () => {
    const fx = newFixture('tenant-a');
    // Issue in tenant B.
    const seeded = await handleSessionIssue(
      {
        tenantId: 'tenant-b',
        correlationId: 'seed',
        principalId: 'user-1',
        userId: 'user-1',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    // Refresh under tenant A — entity-store query is tenant-scoped, so
    // this gets SESSION_NOT_FOUND immediately (the cross-check also
    // exists as defense-in-depth).
    await expect(
      handleSessionRefresh(
        {
          tenantId: 'tenant-a',
          correlationId: 'cross',
          sessionId: seeded.document.sessionId,
          presentedRefreshSecret: seeded.plaintextRefreshToken,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_NOT_FOUND });
  });
});

describe('handleSessionRefresh — ring cap', () => {
  it('revokedRefreshTokenHashes is capped at 16 entries', async () => {
    const fx = newFixture();
    const { sessionId, refreshSecret: initial } = await issue(fx);
    let current = initial;
    // Rotate 20 times. After each rotation the previous hash promotes
    // into the revoked ring; after 20 rotations the ring should hold
    // the most recent 16 (out of 19 rotated-out hashes; the very
    // first rotation has no `previousRefreshTokenHash` to promote).
    for (let i = 0; i < 20; i += 1) {
      const r = await handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: `rot-${i}`,
          sessionId,
          presentedRefreshSecret: current,
        },
        fx.events,
        fx.entities,
      );
      await dispatchAll(fx);
      current = assertDefined(
        r.plaintextRefreshToken,
        'rotation result always carries the new plaintext refresh token',
      );
    }
    const finalRow = await fx.entities.get<AuthSessionDocument>(
      fx.tenantId,
      'AuthSession',
      sessionId,
    );
    const ring = finalRow?.attrs.revokedRefreshTokenHashes ?? [];
    expect(ring.length).toBeLessThanOrEqual(16);
  });
});
