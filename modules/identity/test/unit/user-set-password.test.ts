/**
 * Unit tests for `handlePasswordSet` (Layer 1).
 *
 * The session-fixation reset (revoking every active session on
 * password change) is the most important security property — every
 * test asserts the revoke side-effect with `reason: 'password_changed'`.
 * Complexity-validation branches (length min/max, character-class mix)
 * are exhaustively covered.
 */

import { describe, it, expect } from 'vitest';
import {
  handleUserCreate,
  handleSessionIssue,
  handlePasswordSet,
  IdentityError,
  identityErrorCodes,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

const STRONG = 'CorrectHorseBatteryStaple1!';

async function seedUser(fx: ReturnType<typeof newFixture>): Promise<string> {
  const created = await handleUserCreate(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: 'admin',
      email: 'user@example.com',
    },
    fx.events,
  );
  await dispatchAll(fx);
  return created.document.userId;
}

describe('handlePasswordSet — happy path', () => {
  it('emits Identity.PasswordChanged with the documented envelope', async () => {
    const fx = newFixture();
    const userId = await seedUser(fx);
    const result = await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        principalId: 'admin',
        userId,
        newPassword: STRONG,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.PasswordChanged');
    expect(result.envelope.schemaId).toBe('domain.identity.password.changed.v1');
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:${userId}`,
    ]);
  });

  it('persists Argon2id hash on the document and clears failedLoginCount + lockedUntil', async () => {
    const fx = newFixture();
    const userId = await seedUser(fx);
    // Pre-position lockout state on the user (manual put bypasses the
    // password-login flow we'd normally use to lock it).
    const userRow = await fx.entities.get<{
      userId: string;
      email: string;
      status: string;
      failedLoginCount?: number;
      lockedUntil?: string;
      [k: string]: unknown;
    }>(fx.tenantId, 'User', userId);
    if (!userRow) throw new Error('test setup');
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'User',
      entityId: userId,
      attrs: {
        ...userRow.attrs,
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() + 600_000).toISOString(),
      },
    });
    const result = await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId,
        newPassword: STRONG,
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.passwordHash).toMatch(/^\$/); // PHC string starts with $
    expect(result.document.failedLoginCount).toBe(0);
    expect(result.document.lockedUntil).toBeUndefined();
  });

  it('plaintext password does NOT appear in the persisted document or events', async () => {
    const fx = newFixture();
    const userId = await seedUser(fx);
    const result = await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId,
        newPassword: STRONG,
      },
      fx.events,
      fx.entities,
    );
    expect(JSON.stringify(result.document)).not.toContain(STRONG);
    const eventJson = JSON.stringify(fx.events.events, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(eventJson).not.toContain(STRONG);
  });

  it('session-fixation reset: revokes every active session with reason=password_changed', async () => {
    const fx = newFixture();
    const userId = await seedUser(fx);
    // Issue two sessions before the password change.
    await handleSessionIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 's1',
        principalId: userId,
        userId,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await handleSessionIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 's2',
        principalId: userId,
        userId,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    const result = await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'pwd',
        principalId: userId,
        userId,
        newPassword: STRONG,
      },
      fx.events,
      fx.entities,
    );

    expect(result.revokedSessionIds).toHaveLength(2);
    expect(
      result.follow.every((e) => e.eventType === 'Identity.SessionEnded'),
    ).toBe(true);
    expect(
      result.follow.every((e) => {
        const p = e.payload;
        if (typeof p !== 'object' || p === null) return false;
        return (p as { reason?: unknown }).reason === 'password_changed';
      }),
    ).toBe(true);
  });

  it('returns empty follow + revokedSessionIds when user had no active sessions', async () => {
    const fx = newFixture();
    const userId = await seedUser(fx);
    const result = await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId,
        newPassword: STRONG,
      },
      fx.events,
      fx.entities,
    );
    expect(result.follow).toEqual([]);
    expect(result.revokedSessionIds).toEqual([]);
  });
});

describe('handlePasswordSet — complexity validation', () => {
  const fx = () => newFixture();

  it('rejects passwords shorter than 12 characters with PASSWORD_COMPLEXITY', async () => {
    const f = fx();
    const userId = await seedUser(f);
    await expect(
      handlePasswordSet(
        {
          tenantId: f.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          userId,
          newPassword: 'Short1!',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.PASSWORD_COMPLEXITY });
  });

  it('rejects passwords longer than 256 characters with PASSWORD_COMPLEXITY', async () => {
    const f = fx();
    const userId = await seedUser(f);
    await expect(
      handlePasswordSet(
        {
          tenantId: f.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          userId,
          newPassword: 'A1' + 'a'.repeat(260),
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.PASSWORD_COMPLEXITY });
  });

  it('rejects passwords with only one character class (all-lowercase) with PASSWORD_COMPLEXITY', async () => {
    const f = fx();
    const userId = await seedUser(f);
    await expect(
      handlePasswordSet(
        {
          tenantId: f.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          userId,
          newPassword: 'allllowercase',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.PASSWORD_COMPLEXITY });
  });

  it('accepts mixed lower + upper (no digit/symbol)', async () => {
    const f = fx();
    const userId = await seedUser(f);
    const result = await handlePasswordSet(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId,
        newPassword: 'MixedCaseStrong',
      },
      f.events,
      f.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.PasswordChanged');
  });

  it('accepts lower + digit (no upper)', async () => {
    const f = fx();
    const userId = await seedUser(f);
    const result = await handlePasswordSet(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId,
        newPassword: 'lowercase123digits',
      },
      f.events,
      f.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.PasswordChanged');
  });
});

describe('handlePasswordSet — error paths', () => {
  it('rejects unknown userId with USER_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handlePasswordSet(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          userId: 'usr-ghost',
          newPassword: STRONG,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.USER_NOT_FOUND });
    expect(fx.events.events).toHaveLength(0);
  });

  it('throws IdentityError for every rejection', async () => {
    const fx = newFixture();
    await expect(
      handlePasswordSet(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          userId: 'usr-ghost',
          newPassword: STRONG,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});
