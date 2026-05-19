/**
 * Unit tests for the ApiKey handler trio (Layer 1, Identity Module Test Pass).
 * Combined: `Identity.ApiKey.Create`, `Identity.ApiKey.Rotate`,
 * `Identity.ApiKey.Revoke`. Auth-issuing — every error code must have
 * a no-side-effect assertion and the bearer plaintext must never
 * persist on the document.
 */
import { describe, it, expect } from '@atlas/test';
import { handleApiKeyCreate, handleApiKeyRotate, handleApiKeyRevoke, handleServicePrincipalCreate, IdentityError, identityErrorCodes, type ApiKeyDocument, type ServicePrincipalDocument, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
async function seedSp(fx: ReturnType<typeof newFixture>, scopes: string[] = ['read', 'write'], status: 'active' | 'disabled' = 'active'): Promise<ServicePrincipalDocument> {
    const created = await handleServicePrincipalCreate({
        tenantId: fx.tenantId,
        correlationId: 'seed',
        principalId: 'admin',
        ownerUserId: 'owner-1',
        displayName: 'test-sp',
        scopes,
    }, fx.events);
    await dispatchAll(fx);
    if (status === 'disabled') {
        // Manual flip via store — no separate disable handler signature needed for setup.
        await fx.entities.put({
            tenantId: fx.tenantId,
            entityType: 'ServicePrincipal',
            entityId: created.document.spId,
            attrs: { ...created.document, status: 'disabled' },
        });
    }
    return created.document;
}
describe('handleApiKeyCreate — happy path', function () {
    it('mints a user-owned ApiKey, emits ApiKeyCreated, returns plaintext bearer atlas_<keyId>.<secret>', async function () {
        const fx = newFixture();
        const result = await handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'admin',
            name: 'my-key',
            userId: 'user-1',
            scopes: ['read'],
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.ApiKeyCreated');
        expect(result.envelope.schemaId).toBe('domain.identity.api_key.created.v1');
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `ApiKey:${result.document.keyId}`,
        ]);
        expect(result.plaintextBearer).toMatch(new RegExp(`^atlas_${result.document.keyId}\\.[A-Za-z0-9_-]+$`));
    });
    it('plaintext secret never appears on the persisted document', async function () {
        const fx = newFixture();
        const result = await handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'stealth',
            userId: 'user-2',
            scopes: ['admin'],
        }, fx.events, fx.entities);
        const docJson = JSON.stringify(result.document);
        // Bearer is `atlas_<keyId>.<secret>` — extract the secret part.
        const secret = result.plaintextBearer.split('.').slice(1).join('.');
        expect(docJson).not.toContain(secret);
    });
    it('mints an SP-owned ApiKey when scopes are within the SP ceiling', async function () {
        const fx = newFixture();
        const sp = await seedSp(fx, ['read', 'write']);
        const result = await handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'sp-key',
            servicePrincipalId: sp.spId,
            scopes: ['read'],
        }, fx.events, fx.entities);
        expect(result.document.servicePrincipalId).toBe(sp.spId);
        expect(result.document.userId).toBeUndefined();
        expect(result.document.scopes).toEqual(['read']);
    });
    it('persists expiresAt when provided', async function () {
        const fx = newFixture();
        const expiresAt = new Date(Date.now() + 60000).toISOString();
        const result = await handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'temp',
            userId: 'user-3',
            scopes: ['read'],
            expiresAt,
        }, fx.events, fx.entities);
        expect(result.document.expiresAt).toBe(expiresAt);
    });
});
describe('handleApiKeyCreate — error paths', function () {
    it('rejects when neither userId nor servicePrincipalId is set', async function () {
        const fx = newFixture();
        await expect(handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'orphan',
            scopes: ['read'],
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.IDENTITY_INVALID });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects when both userId AND servicePrincipalId are set', async function () {
        const fx = newFixture();
        await expect(handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'ambiguous',
            userId: 'user-1',
            servicePrincipalId: 'sp-1',
            scopes: ['read'],
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.IDENTITY_INVALID });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects when servicePrincipalId references a non-existent SP', async function () {
        const fx = newFixture();
        await expect(handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'phantom',
            servicePrincipalId: 'sp-doesnt-exist',
            scopes: ['read'],
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.SERVICE_PRINCIPAL_NOT_FOUND,
        });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects when SP is disabled', async function () {
        const fx = newFixture();
        const sp = await seedSp(fx, ['read'], 'disabled');
        const eventsBefore = fx.events.events.length;
        await expect(handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'disabled-sp-key',
            servicePrincipalId: sp.spId,
            scopes: ['read'],
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.SERVICE_PRINCIPAL_DISABLED,
        });
        expect(fx.events.events.length).toBe(eventsBefore);
    });
    it('rejects when scopes exceed the SP ceiling', async function () {
        const fx = newFixture();
        const sp = await seedSp(fx, ['read']);
        const eventsBefore = fx.events.events.length;
        await expect(handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'overscope',
            servicePrincipalId: sp.spId,
            scopes: ['read', 'admin'],
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.SERVICE_PRINCIPAL_SCOPE_EXCEEDED,
        });
        expect(fx.events.events.length).toBe(eventsBefore);
    });
    it('throws IdentityError instances for every rejection', async function () {
        const fx = newFixture();
        await expect(handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            name: 'inst',
            scopes: [],
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
describe('handleApiKeyRotate — happy path', function () {
    async function seedActiveKey(fx: ReturnType<typeof newFixture>): Promise<{
        keyId: string;
        document: ApiKeyDocument;
    }> {
        const created = await handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            name: 'rot-key',
            userId: 'user-1',
            scopes: ['read', 'write'],
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        return { keyId: created.document.keyId, document: created.document };
    }
    it('mints successor and flips predecessor to rotated with overlapUntil set', async function () {
        const fx = newFixture();
        const { keyId } = await seedActiveKey(fx);
        const result = await handleApiKeyRotate({
            tenantId: fx.tenantId,
            correlationId: 'rot-1',
            principalId: 'admin',
            keyId,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.ApiKeyRotated');
        expect(result.predecessor.status).toBe('rotated');
        expect(result.predecessor.rotationOverlapUntil).toBeDefined();
        expect(result.predecessor.rotatedToKeyId).toBe(result.successor.keyId);
        expect(result.successor.status).toBe('active');
        expect(result.successor.rotatedFromKeyId).toBe(keyId);
        // Successor inherits scopes + name from predecessor.
        expect(result.successor.scopes).toEqual(['read', 'write']);
        expect(result.successor.name).toBe('rot-key');
    });
    it('emits two events: ApiKeyRotated (predecessor) primary + ApiKeyCreated (successor) follow', async function () {
        const fx = newFixture();
        const { keyId } = await seedActiveKey(fx);
        const result = await handleApiKeyRotate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            keyId,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.ApiKeyRotated');
        expect(result.follow.map(function (e) {
            return e.eventType;
        })).toEqual([
            'Identity.ApiKeyCreated',
        ]);
    });
    it('honors custom overlapHours', async function () {
        const fx = newFixture();
        const { keyId } = await seedActiveKey(fx);
        const before = Date.now();
        const result = await handleApiKeyRotate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            keyId,
            overlapHours: 1,
        }, fx.events, fx.entities);
        const rotationOverlapUntil = result.predecessor.rotationOverlapUntil;
        if (!rotationOverlapUntil) {
            throw new Error('rotation rollover predecessor missing rotationOverlapUntil');
        }
        const overlapMs = new Date(rotationOverlapUntil).getTime();
        expect(overlapMs - before).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
        expect(overlapMs - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
    });
    it('returns plaintext bearer for the successor only (predecessor secret stays unknown)', async function () {
        const fx = newFixture();
        const { keyId } = await seedActiveKey(fx);
        const result = await handleApiKeyRotate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            keyId,
        }, fx.events, fx.entities);
        expect(result.plaintextBearer).toMatch(new RegExp(`^atlas_${result.successor.keyId}\\.[A-Za-z0-9_-]+$`));
        const docJson = JSON.stringify(result.successor);
        const secret = result.plaintextBearer.split('.').slice(1).join('.');
        expect(docJson).not.toContain(secret);
    });
});
describe('handleApiKeyRotate — error paths', function () {
    it('rejects rotating an unknown keyId with API_KEY_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleApiKeyRotate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            keyId: 'apk-not-real',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.API_KEY_NOT_FOUND });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects rotating an already-rotated key with API_KEY_REVOKED (status=rotated)', async function () {
        const fx = newFixture();
        const seeded = await handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            name: 'will-rotate',
            userId: 'user-1',
            scopes: ['read'],
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        await handleApiKeyRotate({
            tenantId: fx.tenantId,
            correlationId: 'r1',
            principalId: 'admin',
            keyId: seeded.document.keyId,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Try to rotate the now-rotated predecessor again.
        await expect(handleApiKeyRotate({
            tenantId: fx.tenantId,
            correlationId: 'r2',
            principalId: 'admin',
            keyId: seeded.document.keyId,
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.API_KEY_REVOKED });
    });
});
describe('handleApiKeyRevoke', function () {
    it('flips status to revoked and emits ApiKeyRevoked', async function () {
        const fx = newFixture();
        const seeded = await handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            name: 'doomed',
            userId: 'user-1',
            scopes: ['read'],
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handleApiKeyRevoke({
            tenantId: fx.tenantId,
            correlationId: 'rev',
            principalId: 'admin',
            keyId: seeded.document.keyId,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.ApiKeyRevoked');
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `ApiKey:${seeded.document.keyId}`,
        ]);
        expect(result.document.status).toBe('revoked');
        expect(result.document.endedAt).toBeDefined();
        expect(result.document.endReason).toBe('admin_revoke');
    });
    it('rejects revoking an unknown keyId with API_KEY_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleApiKeyRevoke({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            keyId: 'apk-not-real',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.API_KEY_NOT_FOUND });
        expect(fx.events.events).toHaveLength(0);
    });
});
describe('ApiKey trio — tenant scoping', function () {
    it("rotation cannot reach a key in tenant B from tenant A's call", async function () {
        const fx = newFixture('tenant-a');
        const seededInB = await handleApiKeyCreate({
            tenantId: 'tenant-b',
            correlationId: 'seed',
            principalId: 'admin-b',
            name: 'cross',
            userId: 'user-b',
            scopes: ['read'],
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        await expect(handleApiKeyRotate({
            tenantId: 'tenant-a',
            correlationId: 'cross',
            principalId: 'admin-a',
            keyId: seededInB.document.keyId,
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.API_KEY_NOT_FOUND });
    });
});
