/**
 * Unit tests for impersonation handlers (Layer 1, Identity Module Test Pass).
 *
 * Trio: `Authorization.Impersonation.Start` /
 * `Authorization.Impersonation.Action` /
 * `Authorization.Impersonation.End` (also serves the Revoke flow with
 * a different `reason`). Plus the `resolveImpersonationToken` helper
 * since it's the Bearer-validation surface every impersonated request
 * passes through.
 *
 * Auth-issuing AND privilege-escalating — every error code MUST have
 * a no-side-effect assertion. Mandatory audit-pair semantics
 * (`reason` + `ticketUrl` required) and platform-tier retention
 * (`retention:7y`) are core invariants of this surface and asserted
 * explicitly.
 *
 * Idempotency note: Start mints fresh impersonationId per call;
 * Action's idempotencyKey embeds the correlationId; End's
 * idempotencyKey embeds the reason. None of these dedupe at handler
 * scope — the ingress idempotency check above does. No idempotency
 * `describe` block.
 */

import { describe, it, expect } from 'vitest';
import {
  handleImpersonationStart,
  handleImpersonationAction,
  handleImpersonationEnd,
  resolveImpersonationToken,
  IMPERSONATION_RETENTION_TAG,
  IdentityError,
  identityErrorCodes,
} from '../../src/index.ts';
import { newFixture } from '../lib/fixtures.ts';

const VALID = {
  operatorId: 'op-1',
  targetUserId: 'user-target-1',
  reason: 'investigating ticket #42',
  ticketUrl: 'https://support.example.com/tickets/42',
};

describe('handleImpersonationStart — happy path', () => {
  it('emits Authorization.ImpersonationStarted with platform-tier retention', async () => {
    const fx = newFixture();
    const result = await handleImpersonationStart(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        ...VALID,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Authorization.ImpersonationStarted');
    expect(result.envelope.schemaId).toBe(
      'domain.authorization.impersonation_started.v1',
    );
    expect(result.envelope.retentionTag).toBe(IMPERSONATION_RETENTION_TAG);
    expect(result.envelope.retentionTag).toBe('retention:7y');
  });

  it('exact cacheInvalidationTags: Tenant + User (target) + Impersonation', async () => {
    const fx = newFixture();
    const result = await handleImpersonationStart(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        ...VALID,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:${VALID.targetUserId}`,
      `Impersonation:${result.document.impersonationId}`,
    ]);
  });

  it('default duration is 30 minutes', async () => {
    const fx = newFixture();
    const before = Date.now();
    const result = await handleImpersonationStart(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        ...VALID,
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.maxDurationMin).toBe(30);
    const expiresMs = new Date(result.document.expiresAt).getTime();
    expect(expiresMs - before).toBeGreaterThanOrEqual(30 * 60 * 1000 - 5000);
    expect(expiresMs - before).toBeLessThanOrEqual(30 * 60 * 1000 + 5000);
  });

  it('plaintext token surfaced once and bearer formatted as <impersonationId>.<secret>; document stores hash only', async () => {
    const fx = newFixture();
    const result = await handleImpersonationStart(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        ...VALID,
      },
      fx.events,
      fx.entities,
    );
    expect(result.bearerToken).toBe(
      `${result.document.impersonationId}.${result.plaintextToken}`,
    );
    const docJson = JSON.stringify(result.document);
    expect(docJson).not.toContain(result.plaintextToken);
  });

  it('records reason, ticketUrl, expiresAt on the audit event payload', async () => {
    const fx = newFixture();
    const result = await handleImpersonationStart(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        ...VALID,
      },
      fx.events,
      fx.entities,
    );
    const payload = result.envelope.payload as {
      reason: string;
      ticketUrl: string;
      expiresAt: string;
      operatorId: string;
      targetUserId: string;
    };
    expect(payload.reason).toBe(VALID.reason);
    expect(payload.ticketUrl).toBe(VALID.ticketUrl);
    expect(payload.operatorId).toBe(VALID.operatorId);
    expect(payload.targetUserId).toBe(VALID.targetUserId);
  });

  it('honors custom maxDurationMin within the 8-hour cap', async () => {
    const fx = newFixture();
    const result = await handleImpersonationStart(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        ...VALID,
        maxDurationMin: 60,
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.maxDurationMin).toBe(60);
  });

  it('passes readonlyResourceTypes through to the persisted session', async () => {
    const fx = newFixture();
    const result = await handleImpersonationStart(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        ...VALID,
        readonlyResourceTypes: ['Page', 'Catalog'],
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.readonlyResourceTypes).toEqual(['Page', 'Catalog']);
  });
});

describe('handleImpersonationStart — error paths', () => {
  it('rejects empty operatorId with IMPERSONATION_REQUIRES_OPERATOR', async () => {
    const fx = newFixture();
    await expect(
      handleImpersonationStart(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          ...VALID,
          operatorId: '',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_REQUIRES_OPERATOR,
    });
    expect(fx.events.events).toHaveLength(0);
  });

  it('rejects empty reason with IMPERSONATION_REASON_REQUIRED', async () => {
    const fx = newFixture();
    await expect(
      handleImpersonationStart(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          ...VALID,
          reason: '',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_REASON_REQUIRED,
    });
    expect(fx.events.events).toHaveLength(0);
  });

  it('rejects whitespace-only reason with IMPERSONATION_REASON_REQUIRED', async () => {
    const fx = newFixture();
    await expect(
      handleImpersonationStart(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          ...VALID,
          reason: '   \t\n  ',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_REASON_REQUIRED,
    });
  });

  it('rejects empty ticketUrl with IMPERSONATION_TICKET_REQUIRED', async () => {
    const fx = newFixture();
    await expect(
      handleImpersonationStart(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          ...VALID,
          ticketUrl: '',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_TICKET_REQUIRED,
    });
    expect(fx.events.events).toHaveLength(0);
  });

  it('rejects maxDurationMin <= 0 with IMPERSONATION_DURATION_INVALID', async () => {
    const fx = newFixture();
    await expect(
      handleImpersonationStart(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          ...VALID,
          maxDurationMin: 0,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_DURATION_INVALID,
    });
    await expect(
      handleImpersonationStart(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          ...VALID,
          maxDurationMin: -1,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_DURATION_INVALID,
    });
  });

  it('rejects maxDurationMin > 8h hard cap with IMPERSONATION_DURATION_INVALID', async () => {
    const fx = newFixture();
    await expect(
      handleImpersonationStart(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          ...VALID,
          maxDurationMin: 8 * 60 + 1,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_DURATION_INVALID,
    });
    expect(fx.events.events).toHaveLength(0);
  });

  it('throws IdentityError for every rejection', async () => {
    const fx = newFixture();
    await expect(
      handleImpersonationStart(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          ...VALID,
          reason: '',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});

describe('handleImpersonationAction', () => {
  it('emits ImpersonationAction with retention:7y and minimal cache tags', async () => {
    const fx = newFixture();
    const result = await handleImpersonationAction(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        impersonationId: 'imp-1',
        operatorId: VALID.operatorId,
        targetUserId: VALID.targetUserId,
        actionId: 'ContentPages.Page.Update',
      },
      fx.events,
    );
    expect(result.envelope.eventType).toBe('Authorization.ImpersonationAction');
    expect(result.envelope.retentionTag).toBe('retention:7y');
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `Impersonation:imp-1`,
    ]);
  });

  it('includes optional resourceType and resourceId when provided', async () => {
    const fx = newFixture();
    const result = await handleImpersonationAction(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        impersonationId: 'imp-1',
        operatorId: VALID.operatorId,
        targetUserId: VALID.targetUserId,
        actionId: 'ContentPages.Page.Update',
        resourceType: 'Page',
        resourceId: 'page-123',
      },
      fx.events,
    );
    const payload = result.envelope.payload as {
      resourceType?: string;
      resourceId?: string;
    };
    expect(payload.resourceType).toBe('Page');
    expect(payload.resourceId).toBe('page-123');
  });

  it('omits resourceType / resourceId from payload when not provided', async () => {
    const fx = newFixture();
    const result = await handleImpersonationAction(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        impersonationId: 'imp-1',
        operatorId: VALID.operatorId,
        targetUserId: VALID.targetUserId,
        actionId: 'X.Y.Z',
      },
      fx.events,
    );
    const payload = result.envelope.payload as Record<string, unknown>;
    expect('resourceType' in payload).toBe(false);
    expect('resourceId' in payload).toBe(false);
  });
});

describe('handleImpersonationEnd', () => {
  async function startSession(fx: ReturnType<typeof newFixture>) {
    const start = await handleImpersonationStart(
      { tenantId: fx.tenantId, correlationId: 'seed', ...VALID },
      fx.events,
      fx.entities,
    );
    return start;
  }

  it('emits ImpersonationEnded and flips status to ended on operator_ended reason', async () => {
    const fx = newFixture();
    const start = await startSession(fx);
    const result = await handleImpersonationEnd(
      {
        tenantId: fx.tenantId,
        correlationId: 'end',
        impersonationId: start.document.impersonationId,
        principalId: VALID.operatorId,
        reason: 'operator_ended',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Authorization.ImpersonationEnded');
    expect(result.envelope.retentionTag).toBe('retention:7y');
    expect(result.document.status).toBe('ended');
    expect(result.document.endedAt).toBeDefined();
    expect(result.document.endReason).toBe('operator_ended');
  });

  it('flips status to revoked on tenant_revoked and stamps revokedBy', async () => {
    const fx = newFixture();
    const start = await startSession(fx);
    const result = await handleImpersonationEnd(
      {
        tenantId: fx.tenantId,
        correlationId: 'rev',
        impersonationId: start.document.impersonationId,
        principalId: 'tenant-admin-1',
        reason: 'tenant_revoked',
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.status).toBe('revoked');
    expect(result.document.revokedBy).toBe('tenant-admin-1');
  });

  it('flips status to revoked on platform_revoked', async () => {
    const fx = newFixture();
    const start = await startSession(fx);
    const result = await handleImpersonationEnd(
      {
        tenantId: fx.tenantId,
        correlationId: 'platrev',
        impersonationId: start.document.impersonationId,
        principalId: 'platform-1',
        reason: 'platform_revoked',
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.status).toBe('revoked');
    expect(result.document.revokedBy).toBe('platform-1');
  });

  it('flips status to expired on auto_expired (no revokedBy)', async () => {
    const fx = newFixture();
    const start = await startSession(fx);
    const result = await handleImpersonationEnd(
      {
        tenantId: fx.tenantId,
        correlationId: 'exp',
        impersonationId: start.document.impersonationId,
        principalId: 'system',
        reason: 'auto_expired',
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.status).toBe('expired');
    expect(result.document.revokedBy).toBeUndefined();
  });

  it('rejects unknown impersonationId with IMPERSONATION_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleImpersonationEnd(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          impersonationId: 'imp-not-real',
          principalId: 'op',
          reason: 'operator_ended',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_NOT_FOUND,
    });
    expect(fx.events.events).toHaveLength(0);
  });

  it('rejects already-ended session with IMPERSONATION_ENDED', async () => {
    const fx = newFixture();
    const start = await startSession(fx);
    await handleImpersonationEnd(
      {
        tenantId: fx.tenantId,
        correlationId: 'first-end',
        impersonationId: start.document.impersonationId,
        principalId: VALID.operatorId,
        reason: 'operator_ended',
      },
      fx.events,
      fx.entities,
    );
    await expect(
      handleImpersonationEnd(
        {
          tenantId: fx.tenantId,
          correlationId: 'second-end',
          impersonationId: start.document.impersonationId,
          principalId: VALID.operatorId,
          reason: 'operator_ended',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.IMPERSONATION_ENDED });
  });
});

describe('resolveImpersonationToken', () => {
  it('returns ok=true for a valid bearer on an active session', async () => {
    const fx = newFixture();
    const start = await handleImpersonationStart(
      { tenantId: fx.tenantId, correlationId: 'c', ...VALID },
      fx.events,
      fx.entities,
    );
    const result = await resolveImpersonationToken(
      fx.entities,
      fx.tenantId,
      start.bearerToken,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.impersonationId).toBe(start.document.impersonationId);
    }
  });

  it('rejects malformed bearer (no dot) with reason=malformed', async () => {
    const fx = newFixture();
    const result = await resolveImpersonationToken(fx.entities, fx.tenantId, 'no-dot');
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects bearer with empty id or secret as malformed', async () => {
    const fx = newFixture();
    expect(
      await resolveImpersonationToken(fx.entities, fx.tenantId, '.secret'),
    ).toEqual({ ok: false, reason: 'malformed' });
    expect(
      await resolveImpersonationToken(fx.entities, fx.tenantId, 'id.'),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects unknown impersonationId with reason=not_found', async () => {
    const fx = newFixture();
    const result = await resolveImpersonationToken(
      fx.entities,
      fx.tenantId,
      'imp-fake.some-secret',
    );
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects wrong secret with reason=hash_mismatch', async () => {
    const fx = newFixture();
    const start = await handleImpersonationStart(
      { tenantId: fx.tenantId, correlationId: 'c', ...VALID },
      fx.events,
      fx.entities,
    );
    const result = await resolveImpersonationToken(
      fx.entities,
      fx.tenantId,
      `${start.document.impersonationId}.wrong-secret`,
    );
    expect(result).toEqual({ ok: false, reason: 'hash_mismatch' });
  });

  it('rejects revoked session with reason=revoked', async () => {
    const fx = newFixture();
    const start = await handleImpersonationStart(
      { tenantId: fx.tenantId, correlationId: 'c', ...VALID },
      fx.events,
      fx.entities,
    );
    await handleImpersonationEnd(
      {
        tenantId: fx.tenantId,
        correlationId: 'rev',
        impersonationId: start.document.impersonationId,
        principalId: 'tenant-admin',
        reason: 'tenant_revoked',
      },
      fx.events,
      fx.entities,
    );
    const result = await resolveImpersonationToken(
      fx.entities,
      fx.tenantId,
      start.bearerToken,
    );
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });
});

describe('Impersonation — tenant scoping', () => {
  it("session in tenant B is invisible to End/Resolve in tenant A", async () => {
    const fx = newFixture('tenant-a');
    const start = await handleImpersonationStart(
      {
        tenantId: 'tenant-b',
        correlationId: 'seed',
        ...VALID,
      },
      fx.events,
      fx.entities,
    );
    // End in tenant A: not found.
    await expect(
      handleImpersonationEnd(
        {
          tenantId: 'tenant-a',
          correlationId: 'cross',
          impersonationId: start.document.impersonationId,
          principalId: 'op',
          reason: 'operator_ended',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.IMPERSONATION_NOT_FOUND,
    });
    // Resolve in tenant A: not found.
    const resolve = await resolveImpersonationToken(
      fx.entities,
      'tenant-a',
      start.bearerToken,
    );
    expect(resolve).toEqual({ ok: false, reason: 'not_found' });
  });
});
