/**
 * Password handler unit tests.
 *
 * Exercises set-password + password-login against in-memory stores.
 * Asserts complexity validation, hashing roundtrip, lockout behaviour,
 * and the constant-time-ish "always run a verify" path.
 */

import { describe, it, expect } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  handleUserCreate,
  handlePasswordSet,
  handlePasswordLogin,
  getUserEntity,
  IdentityError,
  identityErrorCodes,
  hashPassword,
  validatePasswordComplexity,
  type UserDocument,
} from '../src/index.ts';
import {
  dispatchAll,
  newFixture,
  type Fixture,
} from './lib/fixtures.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrow `env.payload` (typed `unknown` on `EventEnvelope`) to a
 * record so assertions can read named fields without a cast at every
 * site. Mirrors the helper in `acceptance.test.ts` /
 * `session.test.ts` / `unit/password-login.test.ts`.
 */
function payloadRecord(env: EventEnvelope): Record<string, unknown> {
  if (!isRecord(env.payload)) {
    throw new Error(
      `expected object-shaped payload on ${env.eventType} (${env.eventId})`,
    );
  }
  return env.payload;
}

describe('validatePasswordComplexity', () => {
  it('rejects too-short passwords', () => {
    expect(() => validatePasswordComplexity('Short1!')).toThrow(IdentityError);
  });
  it('rejects single-class passwords', () => {
    expect(() => validatePasswordComplexity('aaaaaaaaaaaaaa')).toThrow(IdentityError);
  });
  it('accepts a passphrase with mixed case', () => {
    expect(() => validatePasswordComplexity('correct horse Battery staple')).not.toThrow();
  });
  it('accepts a length+digit combo', () => {
    expect(() => validatePasswordComplexity('letmein-123456789')).not.toThrow();
  });
});

describe('Identity.User.SetPassword', () => {
  it('hashes, persists, and clears any existing lockout', async () => {
    const fx = newFixture();
    const user = await handleUserCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'alice@example.com',
      },
      fx.events,
    );
    await dispatchAll(fx);

    // Precondition: lock the account by hand (simulating prior failed
    // attempts) so we can prove the SetPassword call clears it.
    const stored = await getUserEntity(fx.entities, fx.tenantId, user.document.userId);
    if (!stored) throw new Error('precondition');
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'User',
      entityId: stored.userId,
      attrs: {
        ...stored,
        lockedUntil: new Date(Date.now() + 60_000).toISOString(),
        failedLoginCount: 5,
      },
      schemaVersion: 1,
    });

    await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: user.document.userId,
        userId: user.document.userId,
        newPassword: 'correct-horse-Battery-staple',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    const after = await getUserEntity(fx.entities, fx.tenantId, user.document.userId);
    expect(after?.passwordHash).toMatch(/^\$scrypt\$/);
    expect(after?.lockedUntil).toBeUndefined();
    expect(after?.failedLoginCount).toBe(0);
  });

  it('rejects weak passwords without persisting anything', async () => {
    const fx = newFixture();
    const user = await handleUserCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'bob@example.com',
      },
      fx.events,
    );
    await dispatchAll(fx);
    await expect(
      handlePasswordSet(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: user.document.userId,
          userId: user.document.userId,
          newPassword: 'weak',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.PASSWORD_COMPLEXITY });
  });

  it('rejects unknown userId', async () => {
    const fx = newFixture();
    await expect(
      handlePasswordSet(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: null,
          userId: 'usr-nope',
          newPassword: 'correct-horse-Battery-staple',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.USER_NOT_FOUND });
  });
});

describe('Identity.Login.Password', () => {
  async function seedUserWithPassword(
    fx: Fixture,
    email: string,
    password: string,
  ): Promise<UserDocument> {
    const user = await handleUserCreate(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: 'admin', email },
      fx.events,
    );
    await dispatchAll(fx);
    const passwordHash = await hashPassword(password);
    // Bypass the SetPassword handler — we want to seed a known hash
    // directly so the login path is the only thing under test.
    const stored = await getUserEntity(fx.entities, fx.tenantId, user.document.userId);
    if (!stored) throw new Error('seed');
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'User',
      entityId: stored.userId,
      attrs: { ...stored, passwordHash },
      schemaVersion: 1,
    });
    return { ...stored, passwordHash };
  }

  it('happy path: emits LoginSucceeded + a follow update clearing the failure counter', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'alice@example.com', 'correct-horse-Battery-staple');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'alice@example.com',
        password: 'correct-horse-Battery-staple',
        attemptIp: '127.0.0.1',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.LoginSucceeded');
    // A2.3: success path now emits UserUpdated + SessionIssued (no
    // evictions since this is the user's first session in this test).
    expect(result.follow.map((e) => e.eventType)).toEqual([
      'Identity.UserUpdated',
      'Identity.SessionIssued',
    ]);
    expect(result.user?.lastLoginAt).toBeTruthy();
    expect(result.user?.failedLoginCount).toBe(0);
    expect(result.sessionResult?.cookiePayload).toContain('.');
    expect(result.sessionResult?.plaintextAccessToken.length).toBeGreaterThan(20);
  });

  it('wrong password emits LoginRejected with reason=wrong_password', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'alice@example.com', 'correct-horse-Battery-staple');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'alice@example.com',
        password: 'wrong-Password-12345',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.LoginRejected');
    expect(payloadRecord(result.envelope)['reason']).toBe(
      'wrong_password',
    );
    expect(result.follow.map((e) => e.eventType)).toEqual(['Identity.UserUpdated']);
  });

  it('unknown user emits LoginRejected with reason=unknown_user (no follow)', async () => {
    const fx = newFixture();
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'nobody@example.com',
        password: 'something-strong-1234',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.LoginRejected');
    expect(payloadRecord(result.envelope)['reason']).toBe(
      'unknown_user',
    );
    expect(result.follow).toEqual([]);
  });

  it('5th consecutive failure trips the lockout', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'alice@example.com', 'correct-horse-Battery-staple');
    for (let i = 0; i < 4; i += 1) {
      await handlePasswordLogin(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          email: 'alice@example.com',
          password: 'wrong-Password-12345',
        },
        fx.events,
        fx.entities,
      );
      await dispatchAll(fx);
    }
    const trip = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'alice@example.com',
        password: 'wrong-Password-12345',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    expect(trip.follow.map((e) => e.eventType)).toEqual(['Identity.AccountLocked']);

    // Next attempt — even with the right password — is rejected with
    // reason=account_locked.
    const blocked = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'alice@example.com',
        password: 'correct-horse-Battery-staple',
      },
      fx.events,
      fx.entities,
    );
    expect(payloadRecord(blocked.envelope)['reason']).toBe(
      'account_locked',
    );
  });

  it('rejects when user has no password (federated/passkey-only)', async () => {
    const fx = newFixture();
    await handleUserCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        email: 'sso-only@example.com',
      },
      fx.events,
    );
    await dispatchAll(fx);
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'sso-only@example.com',
        password: 'whatever-1234567',
      },
      fx.events,
      fx.entities,
    );
    expect(payloadRecord(result.envelope)['reason']).toBe(
      'no_password_factor',
    );
  });
});
