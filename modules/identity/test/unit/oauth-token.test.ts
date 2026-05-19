/**
 * Unit tests for OAuth 2.0 client_credentials handlers (Layer 1, Identity Module Test Pass).
 * Combined: `Identity.OAuth.IssueToken` + `Identity.OAuth.RevokeToken`.
 *
 * RFC 6749 + RFC 7009 protocol surface. Auth-issuing — every error path
 * must have a no-side-effect assertion. Revocation must NOT enumerate
 * (RFC 7009 §2.2: respond 200 even on unknown token; we return null
 * envelope so the route emits no audit).
 */
import { describe, it, expect } from 'vitest';
import { handleApiKeyCreate, handleApiKeyRevoke, handleOAuthIssueToken, handleOAuthRevokeToken, handleServicePrincipalCreate, IdentityError, identityErrorCodes, type ApiKeyDocument, type ServicePrincipalDocument, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
async function seedSpAndKey(fx: ReturnType<typeof newFixture>, scopes: string[] = ['read', 'write']): Promise<{
    sp: ServicePrincipalDocument;
    apiKey: ApiKeyDocument;
    bearer: string;
}> {
    const spResult = await handleServicePrincipalCreate({
        tenantId: fx.tenantId,
        correlationId: 'seed',
        principalId: 'admin',
        ownerUserId: 'owner',
        displayName: 'oauth-test',
        scopes,
    }, fx.events);
    await dispatchAll(fx);
    const keyResult = await handleApiKeyCreate({
        tenantId: fx.tenantId,
        correlationId: 'seed',
        principalId: 'admin',
        name: 'oauth-key',
        servicePrincipalId: spResult.document.spId,
        scopes,
    }, fx.events, fx.entities);
    await dispatchAll(fx);
    return {
        sp: spResult.document,
        apiKey: keyResult.document,
        bearer: keyResult.plaintextBearer,
    };
}
describe('handleOAuthIssueToken — happy path', function () {
    it('issues a Bearer token from clientBearer, emits OAuthTokenIssued with full envelope', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx, ['read']);
        const result = await handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            clientBearer: seeded.bearer,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.OAuthTokenIssued');
        expect(result.envelope.schemaId).toBe('domain.identity.oauth.token_issued.v1');
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `ApiKey:${seeded.apiKey.keyId}`,
            `OAuthToken:${result.document.tokenId}`,
        ]);
        expect(result.response.token_type).toBe('Bearer');
        expect(result.response.expires_in).toBe(3600);
        expect(result.response.scope).toBe('read');
    });
    it('also accepts split client_id + client_secret form', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx, ['read']);
        // Bearer is `atlas_<keyId>.<secret>` — extract for split form.
        const secret = seeded.bearer
            .slice('atlas_'.length)
            .split('.')
            .slice(1)
            .join('.');
        const result = await handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientId: seeded.apiKey.keyId,
            clientSecret: secret,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.OAuthTokenIssued');
    });
    it('plaintext access_token is surfaced once and not stored on the document', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx);
        const result = await handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: seeded.bearer,
        }, fx.events, fx.entities);
        const docJson = JSON.stringify(result.document);
        expect(docJson).not.toContain(result.response.access_token);
    });
    it('honors custom ttlSeconds', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx);
        const before = Date.now();
        const result = await handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: seeded.bearer,
            ttlSeconds: 30,
        }, fx.events, fx.entities);
        expect(result.response.expires_in).toBe(30);
        const expiresMs = new Date(result.document.expiresAt).getTime();
        expect(expiresMs - before).toBeGreaterThanOrEqual(29 * 1000);
        expect(expiresMs - before).toBeLessThanOrEqual(35 * 1000);
    });
    it('narrows token scopes to requestedScopes when caller asks for a subset', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx, ['read', 'write']);
        const result = await handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: seeded.bearer,
            requestedScopes: ['read'],
        }, fx.events, fx.entities);
        expect(result.document.scopes).toEqual(['read']);
        expect(result.response.scope).toBe('read');
    });
});
describe('handleOAuthIssueToken — error paths', function () {
    it('rejects malformed clientBearer with OAUTH_INVALID_CLIENT', async function () {
        const fx = newFixture();
        await expect(handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: 'not-a-real-bearer',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.OAUTH_INVALID_CLIENT });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects when no credentials provided at all (no clientBearer, no client_id/secret)', async function () {
        const fx = newFixture();
        await expect(handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.OAUTH_INVALID_CLIENT });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects unknown client (keyId not in store) with OAUTH_INVALID_CLIENT', async function () {
        const fx = newFixture();
        await expect(handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientId: 'apk-fake',
            clientSecret: 'whatever',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.OAUTH_INVALID_CLIENT });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects revoked client with OAUTH_INVALID_CLIENT', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx);
        await handleApiKeyRevoke({
            tenantId: fx.tenantId,
            correlationId: 'rev',
            principalId: 'admin',
            keyId: seeded.apiKey.keyId,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const eventsBefore = fx.events.events.length;
        await expect(handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: seeded.bearer,
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.OAUTH_INVALID_CLIENT });
        expect(fx.events.events.length).toBe(eventsBefore);
    });
    it('rejects wrong client_secret with OAUTH_INVALID_CLIENT', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx);
        await expect(handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientId: seeded.apiKey.keyId,
            clientSecret: 'absolutely-not-the-real-secret',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.OAUTH_INVALID_CLIENT });
    });
    it('rejects requestedScopes that exceed the ApiKey scopes with OAUTH_INVALID_SCOPE', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx, ['read']);
        await expect(handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: seeded.bearer,
            requestedScopes: ['read', 'admin'],
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.OAUTH_INVALID_SCOPE });
    });
    it('rejects expired ApiKey with API_KEY_EXPIRED', async function () {
        const fx = newFixture();
        const expiredAt = new Date(Date.now() - 60000).toISOString();
        const sp = await handleServicePrincipalCreate({
            tenantId: fx.tenantId,
            correlationId: 's',
            principalId: 'admin',
            ownerUserId: 'o',
            displayName: 'sp',
            scopes: ['read'],
        }, fx.events);
        await dispatchAll(fx);
        const key = await handleApiKeyCreate({
            tenantId: fx.tenantId,
            correlationId: 's',
            principalId: 'admin',
            name: 'expired',
            servicePrincipalId: sp.document.spId,
            scopes: ['read'],
            expiresAt: expiredAt,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        await expect(handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: key.plaintextBearer,
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.API_KEY_EXPIRED });
    });
    it('throws IdentityError instances for every rejection', async function () {
        const fx = newFixture();
        await expect(handleOAuthIssueToken({ tenantId: fx.tenantId, correlationId: 'c' }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
describe('handleOAuthRevokeToken — RFC 7009 semantics', function () {
    it('returns null envelope on unknown token (no enumeration leak)', async function () {
        const fx = newFixture();
        const result = await handleOAuthRevokeToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: 'completely-unknown-token-xxxxxxxxxxxxx',
        }, fx.events, fx.entities);
        expect(result.envelope).toBeNull();
        expect(result.document).toBeNull();
        expect(fx.events.events).toHaveLength(0);
    });
    it('flips status to revoked and emits OAuthTokenRevoked on first revoke', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx);
        const issued = await handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: seeded.bearer,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handleOAuthRevokeToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: issued.response.access_token,
        }, fx.events, fx.entities);
        expect(result.envelope?.eventType).toBe('Identity.OAuthTokenRevoked');
        expect(result.envelope?.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `OAuthToken:${issued.document.tokenId}`,
        ]);
        expect(result.document?.status).toBe('revoked');
        expect(result.document?.revokedReason).toBe('client_revoke');
    });
    it('emits no fresh event on second revoke (idempotent)', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx);
        const issued = await handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: seeded.bearer,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        await handleOAuthRevokeToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: issued.response.access_token,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const eventsBefore = fx.events.events.length;
        const second = await handleOAuthRevokeToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: issued.response.access_token,
        }, fx.events, fx.entities);
        expect(second.envelope).toBeNull();
        // Document is returned (already revoked) but no new event.
        expect(second.document?.status).toBe('revoked');
        expect(fx.events.events.length).toBe(eventsBefore);
    });
    it('honors custom revoke reason (admin_revoke vs client_revoke)', async function () {
        const fx = newFixture();
        const seeded = await seedSpAndKey(fx);
        const issued = await handleOAuthIssueToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            clientBearer: seeded.bearer,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handleOAuthRevokeToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            presentedToken: issued.response.access_token,
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(result.document?.revokedReason).toBe('admin_revoke');
    });
});
