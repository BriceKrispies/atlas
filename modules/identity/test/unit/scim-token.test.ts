/**
 * Unit tests for the ScimToken trio (Layer 1).
 * Combined: `Identity.ScimToken.{Enable, Rotate, Revoke}`.
 *
 * Auth-issuing — secret hygiene assertions are mandatory.
 */

import { describe, it, expect } from 'vitest';
import {
  handleScimTokenEnable,
  handleScimTokenRotate,
  handleScimTokenRevoke,
  IdentityError,
  identityErrorCodes,
  type ScimTokenDocument,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

async function seedActive(
  fx: ReturnType<typeof newFixture>,
): Promise<{ document: ScimTokenDocument; secret: string }> {
  const r = await handleScimTokenEnable(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: 'admin',
      name: 'okta-connector',
    },
    fx.events,
  );
  await dispatchAll(fx);
  return { document: r.document, secret: r.plaintextSecret };
}

describe('handleScimTokenEnable', () => {
  it('emits ScimTokenEnabled with status=active and exact cache tags', async () => {
    const fx = newFixture();
    const result = await handleScimTokenEnable(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        principalId: 'admin',
        name: 'okta',
      },
      fx.events,
    );
    expect(result.envelope.eventType).toBe('Identity.ScimTokenEnabled');
    expect(result.envelope.schemaId).toBe(
      'domain.identity.scim_token.enabled.v1',
    );
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `ScimToken:${result.document.tokenId}`,
    ]);
    expect(result.document.status).toBe('active');
  });

  it('plaintext secret surfaced once and not on the document', async () => {
    const fx = newFixture();
    const result = await handleScimTokenEnable(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        name: 'noleak',
      },
      fx.events,
    );
    expect(result.plaintextSecret.length).toBeGreaterThan(20);
    const docJson = JSON.stringify(result.document);
    expect(docJson).not.toContain(result.plaintextSecret);
  });

  it('persists optional expiresAt', async () => {
    const fx = newFixture();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const result = await handleScimTokenEnable(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        name: 'temporal',
        expiresAt,
      },
      fx.events,
    );
    expect(result.document.expiresAt).toBe(expiresAt);
  });
});

describe('handleScimTokenRotate', () => {
  it('mints successor, flips predecessor to rotated, returns new plaintext', async () => {
    const fx = newFixture();
    const seeded = await seedActive(fx);
    const result = await handleScimTokenRotate(
      {
        tenantId: fx.tenantId,
        correlationId: 'rot',
        principalId: 'admin',
        tokenId: seeded.document.tokenId,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.ScimTokenRotated');
    expect(result.predecessor.status).toBe('rotated');
    expect(result.predecessor.rotatedToTokenId).toBe(result.successor.tokenId);
    expect(result.predecessor.rotationOverlapUntil).toBeDefined();
    expect(result.successor.status).toBe('active');
    expect(result.successor.rotatedFromTokenId).toBe(seeded.document.tokenId);
    expect(result.successor.name).toBe(seeded.document.name);
    expect(result.follow.map((e) => e.eventType)).toEqual([
      'Identity.ScimTokenEnabled',
    ]);
  });

  it('honors custom overlapHours', async () => {
    const fx = newFixture();
    const seeded = await seedActive(fx);
    const before = Date.now();
    const result = await handleScimTokenRotate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        tokenId: seeded.document.tokenId,
        overlapHours: 1,
      },
      fx.events,
      fx.entities,
    );
    const rotationOverlapUntil = result.predecessor.rotationOverlapUntil;
    if (!rotationOverlapUntil) {
      throw new Error('rotation rollover predecessor missing rotationOverlapUntil');
    }
    const overlapMs = new Date(rotationOverlapUntil).getTime();
    expect(overlapMs - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
    expect(overlapMs - before).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });

  it('rejects unknown tokenId with SCIM_TOKEN_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleScimTokenRotate(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          tokenId: 'scim-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SCIM_TOKEN_NOT_FOUND });
    expect(fx.events.events).toHaveLength(0);
  });

  it('rejects rotation of already-rotated token with SCIM_TOKEN_REVOKED', async () => {
    const fx = newFixture();
    const seeded = await seedActive(fx);
    await handleScimTokenRotate(
      {
        tenantId: fx.tenantId,
        correlationId: 'r1',
        principalId: 'admin',
        tokenId: seeded.document.tokenId,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await expect(
      handleScimTokenRotate(
        {
          tenantId: fx.tenantId,
          correlationId: 'r2',
          principalId: 'admin',
          tokenId: seeded.document.tokenId,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SCIM_TOKEN_REVOKED });
  });
});

describe('handleScimTokenRevoke', () => {
  it('flips status to revoked and emits ScimTokenRevoked', async () => {
    const fx = newFixture();
    const seeded = await seedActive(fx);
    const result = await handleScimTokenRevoke(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        tokenId: seeded.document.tokenId,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.ScimTokenRevoked');
    expect(result.document.status).toBe('revoked');
    expect(result.document.endedAt).toBeDefined();
    expect(result.document.endReason).toBe('admin_revoke');
  });

  it('rejects unknown tokenId with SCIM_TOKEN_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleScimTokenRevoke(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          tokenId: 'scim-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SCIM_TOKEN_NOT_FOUND });
  });

  it('throws IdentityError for rejection', async () => {
    const fx = newFixture();
    await expect(
      handleScimTokenRevoke(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          tokenId: 'scim-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});

describe('ScimToken trio — tenant scoping', () => {
  it('token in tenant B is invisible to tenant A handlers', async () => {
    const fx = newFixture('tenant-a');
    const inB = await handleScimTokenEnable(
      {
        tenantId: 'tenant-b',
        correlationId: 's',
        principalId: 'admin-b',
        name: 'cross',
      },
      fx.events,
    );
    await dispatchAll(fx);
    await expect(
      handleScimTokenRevoke(
        {
          tenantId: 'tenant-a',
          correlationId: 'cross',
          principalId: 'admin-a',
          tokenId: inB.document.tokenId,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SCIM_TOKEN_NOT_FOUND });
  });
});
