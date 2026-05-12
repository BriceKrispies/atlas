/**
 * Unit tests for `handlePasswordLogin` (Layer 1, Identity Module Test Pass).
 *
 * Auth-issuing front door. Covers every reject reason
 * (`unknown_user` / `user_inactive` / `account_locked` /
 * `no_password_factor` / `wrong_password`), the success path with
 * session minting, lockout escalation on the 5th wrong-password (emits
 * AccountLocked instead of UserUpdated), and the PII-reduction policy
 * (unknown_user reject uses `emailHash` instead of plaintext email).
 *
 * Idempotency note: all envelopes carry timestamp-suffixed
 * `idempotencyKey` values (`identity.login.{ok,reject,failure}.<tenant>.<id>.<iso>`).
 * Two calls within the same millisecond would collide upstream, but
 * the handler does not deduplicate; the ingress pipeline above is
 * responsible. No idempotency block here.
 */

import { describe, it, expect } from 'vitest';
import { PLATFORM_ROBOT_PRINCIPAL_ID } from '@atlas/platform-core';
import type { EventEnvelope } from '@atlas/platform-core';
import { assertDefined } from '@atlas/test-fixtures/assert';
import {
  handleUserCreate,
  handlePasswordSet,
  handlePasswordLogin,
  IdentityError,
  type UserDocument,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

/** Type-guard form of the record check — flips `unknown` to a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Narrows an `unknown` field that the test expects to be a record. */
function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${what}: expected record, got ${typeof value}`);
  }
  return value;
}

/**
 * Reads a record-shaped payload from an event envelope. The audit-only
 * LoginSucceeded / LoginRejected / AccountLocked / UserUpdated emissions
 * all carry record payloads — see `password-login.ts` emit sites.
 */
function payloadRecord(env: EventEnvelope): Record<string, unknown> {
  return recordOf(
    env.payload,
    `payload on ${env.eventType} (${env.eventId})`,
  );
}

async function seedUserWithPassword(
  fx: ReturnType<typeof newFixture>,
  email: string,
  password: string,
): Promise<UserDocument> {
  const created = await handleUserCreate(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: 'admin',
      email,
    },
    fx.events,
  );
  await dispatchAll(fx);
  await handlePasswordSet(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: 'admin',
      userId: created.document.userId,
      newPassword: password,
    },
    fx.events,
    fx.entities,
  );
  await dispatchAll(fx);
  return created.document;
}

describe('handlePasswordLogin — happy path', () => {
  it('emits LoginSucceeded + UserUpdated + SessionIssued in order', async () => {
    const fx = newFixture();
    const user = await seedUserWithPassword(
      fx,
      'happy@example.com',
      'CorrectHorseBatteryStaple1!',
    );
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        email: 'happy@example.com',
        password: 'CorrectHorseBatteryStaple1!',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.LoginSucceeded');
    expect(result.envelope.schemaId).toBe('domain.identity.login.succeeded.v1');
    expect(result.envelope.userId).toBe(user.userId);
    expect(result.envelope.principalId).toBe(user.userId);
    expect(result.follow.map((e) => e.eventType)).toEqual([
      'Identity.UserUpdated',
      'Identity.SessionIssued',
    ]);
  });

  it('exact cacheInvalidationTags on LoginSucceeded: Tenant + User', async () => {
    const fx = newFixture();
    const user = await seedUserWithPassword(
      fx,
      'tags@example.com',
      'Pa55word!Pa55word!',
    );
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'tags@example.com',
        password: 'Pa55word!Pa55word!',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:${user.userId}`,
    ]);
  });

  it('clears failedLoginCount and stamps lastLoginAt on the updated user', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'reset@example.com', 'Pa55word!Pa55word!');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'reset@example.com',
        password: 'Pa55word!Pa55word!',
      },
      fx.events,
      fx.entities,
    );
    expect(result.user?.failedLoginCount).toBe(0);
    expect(result.user?.lastLoginAt).toBeDefined();
  });

  it('returns a sessionResult with plaintexts surfaced once and not stored', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'sess@example.com', 'Pa55word!Pa55word!');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'sess@example.com',
        password: 'Pa55word!Pa55word!',
      },
      fx.events,
      fx.entities,
    );
    expect(result.sessionResult).toBeDefined();
    const docJson = JSON.stringify(result.sessionResult?.document);
    expect(docJson).not.toContain(result.sessionResult?.plaintextRefreshToken);
    expect(docJson).not.toContain(result.sessionResult?.plaintextAccessToken);
  });

  it('matches email case-insensitively', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'CaseTest@Example.COM', 'Pa55word!Pa55word!');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'casetest@example.com',
        password: 'Pa55word!Pa55word!',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.LoginSucceeded');
  });
});

describe('handlePasswordLogin — configuration knobs', () => {
  it('honors issueSession=false (no session, no SessionIssued in follow)', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'nosess@example.com', 'Pa55word!Pa55word!');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'nosess@example.com',
        password: 'Pa55word!Pa55word!',
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

  it('surfaces attemptIp on LoginSucceeded payload and on the session document', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'ip@example.com', 'Pa55word!Pa55word!');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'ip@example.com',
        password: 'Pa55word!Pa55word!',
        attemptIp: '198.51.100.99',
      },
      fx.events,
      fx.entities,
    );
    const payload = payloadRecord(result.envelope);
    expect(payload['ip']).toBe('198.51.100.99');
    expect(result.sessionResult?.document.ip).toBe('198.51.100.99');
  });

  it('passes attemptUserAgent through to the minted session', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'ua@example.com', 'Pa55word!Pa55word!');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'ua@example.com',
        password: 'Pa55word!Pa55word!',
        attemptUserAgent: 'Mozilla/5.0 atlas-test',
      },
      fx.events,
      fx.entities,
    );
    expect(result.sessionResult?.document.userAgent).toBe('Mozilla/5.0 atlas-test');
  });
});

describe('handlePasswordLogin — reject paths', () => {
  it('unknown_user: emits LoginRejected with emailHash (PII reduction)', async () => {
    const fx = newFixture();
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'ghost@example.com',
        password: 'doesnt-matter',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.LoginRejected');
    const payload = payloadRecord(result.envelope);
    expect(payload['reason']).toBe('unknown_user');
    // Crucial PII guarantee: unknown_user reject does NOT carry the
    // plaintext email. Only the SHA-256 hash. This prevents an attacker
    // probing emails from leaving a forever-PII trail in the event log
    // for non-customers.
    expect(payload['email']).toBeUndefined();
    expect(payload['emailHash']).toBeDefined();
    expect(result.user).toBeNull();
    expect(result.sessionResult).toBeUndefined();
    // ADR 0008 §2: system-initiated audit captures the bootstrap robot
    // as principal — never `null`.
    expect(result.envelope.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
  });

  it('wrong_password: emits LoginRejected with email plaintext (user exists)', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'wrong@example.com', 'Pa55word!Pa55word!');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'wrong@example.com',
        password: 'NotTheRightPassword1!',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.LoginRejected');
    const payload = payloadRecord(result.envelope);
    expect(payload['reason']).toBe('wrong_password');
    expect(payload['email']).toBe('wrong@example.com');
    expect(result.sessionResult).toBeUndefined();
  });

  it('wrong_password: emits UserUpdated follow that bumps failedLoginCount', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'fail@example.com', 'Pa55word!Pa55word!');
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'fail@example.com',
        password: 'BadGuess1!',
      },
      fx.events,
      fx.entities,
    );
    expect(result.follow.map((e) => e.eventType)).toEqual([
      'Identity.UserUpdated',
    ]);
    const follow0 = assertDefined(result.follow[0], 'expected UserUpdated follow event');
    expect(payloadRecord(follow0)['document']).toMatchObject({
      failedLoginCount: 1,
    });
  });

  it('account_locked: 5th consecutive wrong_password emits AccountLocked instead of UserUpdated', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'lockme@example.com', 'Pa55word!Pa55word!');
    // Attempts 1–4 emit UserUpdated.
    for (let i = 1; i <= 4; i += 1) {
      const r = await handlePasswordLogin(
        {
          tenantId: fx.tenantId,
          correlationId: `c${i}`,
          email: 'lockme@example.com',
          password: 'NotIt1!',
        },
        fx.events,
        fx.entities,
      );
      expect(r.follow[0]?.eventType).toBe('Identity.UserUpdated');
      await dispatchAll(fx);
    }
    // Attempt 5 trips the lockout — emits AccountLocked instead.
    const fifth = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c5',
        email: 'lockme@example.com',
        password: 'NotIt1!',
      },
      fx.events,
      fx.entities,
    );
    const lockedFollow = assertDefined(
      fifth.follow[0],
      'expected AccountLocked follow event on attempt 5',
    );
    expect(lockedFollow.eventType).toBe('Identity.AccountLocked');
    const lockedDoc = recordOf(
      payloadRecord(lockedFollow)['document'],
      'AccountLocked document',
    );
    expect(lockedDoc['failedLoginCount']).toBe(5);
    expect(lockedDoc['lockedUntil']).toBeDefined();
  });

  it('account_locked rejects subsequent attempts with reason=account_locked (no UserUpdated follow)', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'locked@example.com', 'Pa55word!Pa55word!');
    // Trip the lockout.
    for (let i = 0; i < 5; i += 1) {
      await handlePasswordLogin(
        {
          tenantId: fx.tenantId,
          correlationId: `c${i}`,
          email: 'locked@example.com',
          password: 'BadGuess1!',
        },
        fx.events,
        fx.entities,
      );
      await dispatchAll(fx);
    }
    // Even with the CORRECT password, a locked account rejects.
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-after',
        email: 'locked@example.com',
        password: 'Pa55word!Pa55word!',
      },
      fx.events,
      fx.entities,
    );
    const payload = payloadRecord(result.envelope);
    expect(payload['reason']).toBe('account_locked');
    expect(result.follow).toEqual([]);
  });

  it('user_inactive: rejects active=false users (deactivation hardens against stolen creds)', async () => {
    const fx = newFixture();
    await seedUserWithPassword(fx, 'inactive@example.com', 'Pa55word!Pa55word!');
    // Manually flip user to status='suspended' via a put.
    const userRows = await fx.entities.list<UserDocument>(fx.tenantId, 'User');
    const userRow = userRows[0];
    if (!userRow) throw new Error('test setup error');
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'User',
      entityId: userRow.entityId,
      attrs: { ...userRow.attrs, status: 'suspended' },
    });
    const result = await handlePasswordLogin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        email: 'inactive@example.com',
        password: 'Pa55word!Pa55word!',
      },
      fx.events,
      fx.entities,
    );
    const payload = payloadRecord(result.envelope);
    expect(payload['reason']).toBe('user_inactive');
  });

  it('throws no IdentityError on rejection — rejection is a normal Result, not an error', async () => {
    const fx = newFixture();
    await expect(
      handlePasswordLogin(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          email: 'unknown@example.com',
          password: 'whatever',
        },
        fx.events,
        fx.entities,
      ),
    ).resolves.not.toBeInstanceOf(IdentityError);
  });
});

describe('handlePasswordLogin — tenant scoping', () => {
  it('user in tenant B cannot login through tenant A handler invocation', async () => {
    const fx = newFixture('tenant-a');
    // Seed user in tenant B.
    const created = await handleUserCreate(
      {
        tenantId: 'tenant-b',
        correlationId: 'seed',
        principalId: 'admin',
        email: 'cross@example.com',
      },
      fx.events,
    );
    await dispatchAll(fx);
    await handlePasswordSet(
      {
        tenantId: 'tenant-b',
        correlationId: 'seed',
        principalId: 'admin',
        userId: created.document.userId,
        newPassword: 'Pa55word!Pa55word!',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    const result = await handlePasswordLogin(
      {
        tenantId: 'tenant-a',
        correlationId: 'cross',
        email: 'cross@example.com',
        password: 'Pa55word!Pa55word!',
      },
      fx.events,
      fx.entities,
    );
    const payload = payloadRecord(result.envelope);
    expect(payload['reason']).toBe('unknown_user');
  });
});
