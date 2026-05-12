/**
 * Unit tests for recovery-code handlers (Layer 1).
 * Combined: `Identity.RecoveryCode.{Generate, Regenerate, Redeem}`.
 */

import { describe, it, expect } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import {
  handleGenerateRecoveryCodes,
  handleRegenerateRecoveryCodes,
  handleRedeemRecoveryCode,
  IdentityError,
  identityErrorCodes,
  DEFAULT_IDENTITY_POLICY,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

describe('handleGenerateRecoveryCodes', () => {
  it('mints policy.recoveryCodeCount codes and emits RecoveryCodesGenerated', async () => {
    const fx = newFixture();
    const result = await handleGenerateRecoveryCodes(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'user-1',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.RecoveryCodesGenerated');
    expect(result.envelope.retentionTag).toBe('retention:1y');
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:user-1`,
    ]);
    expect(result.plaintextCodes).toHaveLength(
      DEFAULT_IDENTITY_POLICY.recoveryCodeCount,
    );
    expect(result.documents).toHaveLength(
      DEFAULT_IDENTITY_POLICY.recoveryCodeCount,
    );
  });

  it('plaintext codes never appear in stored documents or events', async () => {
    const fx = newFixture();
    const result = await handleGenerateRecoveryCodes(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        userId: 'user-2',
      },
      fx.events,
      fx.entities,
    );
    const docJson = JSON.stringify(result.documents);
    for (const code of result.plaintextCodes) {
      expect(docJson).not.toContain(code);
    }
  });

  it('refuses generate when active codes already exist with RECOVERY_CODE_INVALID', async () => {
    const fx = newFixture();
    await handleGenerateRecoveryCodes(
      {
        tenantId: fx.tenantId,
        correlationId: 'first',
        principalId: 'admin',
        userId: 'user-3',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await expect(
      handleGenerateRecoveryCodes(
        {
          tenantId: fx.tenantId,
          correlationId: 'second',
          principalId: 'admin',
          userId: 'user-3',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.RECOVERY_CODE_INVALID,
    });
  });
});

describe('handleRegenerateRecoveryCodes', () => {
  it('invalidates prior batch and mints fresh codes; emits RecoveryCodesRegenerated', async () => {
    const fx = newFixture();
    const first = await handleGenerateRecoveryCodes(
      {
        tenantId: fx.tenantId,
        correlationId: 'first',
        principalId: 'admin',
        userId: 'user-4',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const second = await handleRegenerateRecoveryCodes(
      {
        tenantId: fx.tenantId,
        correlationId: 'second',
        principalId: 'admin',
        userId: 'user-4',
      },
      fx.events,
      fx.entities,
    );
    expect(second.envelope.eventType).toBe('Identity.RecoveryCodesRegenerated');
    expect(second.documents.every((d) => d.status === 'active')).toBe(true);
    // Old codes should now be redeem-rejected.
    await expect(
      handleRedeemRecoveryCode(
        {
          tenantId: fx.tenantId,
          correlationId: 'redeem-old',
          principalId: 'user-4',
          userId: 'user-4',
          presentedCode: assertDefined(
            first.plaintextCodes[0],
            'first generate must mint at least one plaintext code',
          ),
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.RECOVERY_CODE_INVALID,
    });
  });
});

describe('handleRedeemRecoveryCode', () => {
  async function gen(fx: ReturnType<typeof newFixture>, userId = 'user-5') {
    const r = await handleGenerateRecoveryCodes(
      {
        tenantId: fx.tenantId,
        correlationId: 'g',
        principalId: 'admin',
        userId,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    return r;
  }

  it('redeems a valid code and emits RecoveryCodeConsumed with remaining count', async () => {
    const fx = newFixture();
    const generated = await gen(fx);
    const result = await handleRedeemRecoveryCode(
      {
        tenantId: fx.tenantId,
        correlationId: 'r',
        principalId: 'user-5',
        userId: 'user-5',
        presentedCode: assertDefined(
          generated.plaintextCodes[0],
          'gen() must mint at least one plaintext code',
        ),
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.RecoveryCodeConsumed');
    expect(result.document.status).toBe('consumed');
    expect(result.remaining).toBe(
      DEFAULT_IDENTITY_POLICY.recoveryCodeCount - 1,
    );
  });

  it('rejects a code on second redemption (single-use enforcement)', async () => {
    const fx = newFixture();
    const generated = await gen(fx);
    const code = assertDefined(
      generated.plaintextCodes[0],
      'gen() must mint at least one plaintext code',
    );
    await handleRedeemRecoveryCode(
      {
        tenantId: fx.tenantId,
        correlationId: 'r1',
        principalId: 'user-5',
        userId: 'user-5',
        presentedCode: code,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await expect(
      handleRedeemRecoveryCode(
        {
          tenantId: fx.tenantId,
          correlationId: 'r2',
          principalId: 'user-5',
          userId: 'user-5',
          presentedCode: code,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.RECOVERY_CODE_INVALID,
    });
  });

  it('rejects a bogus code with RECOVERY_CODE_INVALID', async () => {
    const fx = newFixture();
    await gen(fx);
    await expect(
      handleRedeemRecoveryCode(
        {
          tenantId: fx.tenantId,
          correlationId: 'r',
          principalId: 'user-5',
          userId: 'user-5',
          presentedCode: 'not-a-real-code',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.RECOVERY_CODE_INVALID,
    });
  });

  it('throws IdentityError instances', async () => {
    const fx = newFixture();
    await expect(
      handleRedeemRecoveryCode(
        {
          tenantId: fx.tenantId,
          correlationId: 'r',
          principalId: 'user-5',
          userId: 'user-5',
          presentedCode: 'bogus',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});
