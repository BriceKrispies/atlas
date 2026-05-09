/**
 * Unit tests for `handleFactorRevoke` (Layer 1).
 *
 * AuthFactor.Enroll has no dedicated handler — it's emitted by
 * specific factor handlers (`totp.ts`, `webauthn-register.ts`,
 * `recovery-code.ts`). Those tests cover enrollment branches; this
 * file owns the revoke branches and the last-factor-protected guard.
 */

import { describe, it, expect } from 'vitest';
import {
  handleTotpEnroll,
  handleFactorRevoke,
  IdentityError,
  identityErrorCodes,
  DEFAULT_IDENTITY_POLICY,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

async function enrollTotp(
  fx: ReturnType<typeof newFixture>,
  userId = 'user-1',
  name = 'phone-1',
) {
  const r = await handleTotpEnroll(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: userId,
      userId,
      issuer: 'Atlas',
      accountLabel: 'user@example.com',
      name,
    },
    fx.events,
    fx.secrets,
  );
  await dispatchAll(fx);
  return r.document.factorId;
}

describe('handleFactorRevoke', () => {
  it('emits AuthFactorRevoked, flips status, stamps endReason=user_revoke for self-revoke', async () => {
    const fx = newFixture();
    const factorId = await enrollTotp(fx, 'user-1');
    const result = await handleFactorRevoke(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'user-1',
        factorId,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.AuthFactorRevoked');
    expect(result.envelope.retentionTag).toBe('retention:1y');
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:user-1`,
      `AuthFactor:${factorId}`,
    ]);
    expect(result.document.status).toBe('revoked');
    expect(result.document.endReason).toBe('user_revoke');
  });

  it('stamps endReason=admin_revoke when principalId !== userId', async () => {
    const fx = newFixture();
    const factorId = await enrollTotp(fx, 'user-2');
    const result = await handleFactorRevoke(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        factorId,
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.endReason).toBe('admin_revoke');
  });

  it('rejects unknown factorId with MFA_FACTOR_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleFactorRevoke(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          factorId: 'fct-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_NOT_FOUND });
    expect(fx.events.events).toHaveLength(0);
  });

  it('refuses last-factor revoke when policy.mfaRequired and not forced', async () => {
    const fx = newFixture();
    const factorId = await enrollTotp(fx, 'user-3'); // single factor
    await expect(
      handleFactorRevoke(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          factorId,
          policy: { ...DEFAULT_IDENTITY_POLICY, mfaRequired: true },
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.MFA_LAST_FACTOR_PROTECTED,
    });
  });

  it('allows last-factor revoke when force=true (admin override)', async () => {
    const fx = newFixture();
    const factorId = await enrollTotp(fx, 'user-4');
    const result = await handleFactorRevoke(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        factorId,
        policy: { ...DEFAULT_IDENTITY_POLICY, mfaRequired: true },
        force: true,
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.status).toBe('revoked');
    const payload = result.envelope.payload as { force: boolean };
    expect(payload.force).toBe(true);
  });

  it('allows revoke when user has multiple active factors (last-factor guard does not fire)', async () => {
    const fx = newFixture();
    const f1 = await enrollTotp(fx, 'user-5', 'phone-1');
    await enrollTotp(fx, 'user-5', 'phone-2');
    const result = await handleFactorRevoke(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        factorId: f1,
        policy: { ...DEFAULT_IDENTITY_POLICY, mfaRequired: true },
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.status).toBe('revoked');
  });

  it('throws IdentityError for rejection', async () => {
    const fx = newFixture();
    await expect(
      handleFactorRevoke(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          factorId: 'fct-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});
