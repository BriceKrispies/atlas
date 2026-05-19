/**
 * Unit tests for the ServicePrincipal trio (Layer 1).
 * Combined: `Identity.ServicePrincipal.{Create, SetScopes, Disable}`.
 *
 * Admin-shape CRUD with one branch each. The most security-relevant
 * property is that disabled SPs reject downstream key issuance — that
 * cross-handler interaction is asserted in `unit/api-key.test.ts`,
 * not here.
 */
import { describe, it, expect } from 'vitest';
import { handleServicePrincipalCreate, handleServicePrincipalSetScopes, handleServicePrincipalDisable, IdentityError, identityErrorCodes, type ServicePrincipalDocument, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
async function seedSp(fx: ReturnType<typeof newFixture>, scopes: string[] = ['read']): Promise<ServicePrincipalDocument> {
    const created = await handleServicePrincipalCreate({
        tenantId: fx.tenantId,
        correlationId: 'seed',
        principalId: 'admin',
        ownerUserId: 'owner-1',
        displayName: 'sp-test',
        scopes,
    }, fx.events);
    await dispatchAll(fx);
    return created.document;
}
describe('handleServicePrincipalCreate', function () {
    it('emits ServicePrincipalCreated with status=active and exact cache tags', async function () {
        const fx = newFixture();
        const result = await handleServicePrincipalCreate({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'admin',
            ownerUserId: 'owner-1',
            displayName: 'integrations',
            scopes: ['read', 'write'],
        }, fx.events);
        expect(result.envelope.eventType).toBe('Identity.ServicePrincipalCreated');
        expect(result.envelope.schemaId).toBe('domain.identity.service_principal.created.v1');
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `ServicePrincipal:${result.document.spId}`,
        ]);
        expect(result.document.status).toBe('active');
        expect(result.document.scopes).toEqual(['read', 'write']);
        expect(result.document.ownerUserId).toBe('owner-1');
    });
    it('persists scopes as a copy (no aliasing)', async function () {
        const fx = newFixture();
        const inputScopes = ['read'];
        const result = await handleServicePrincipalCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            ownerUserId: 'owner',
            displayName: 'isolation',
            scopes: inputScopes,
        }, fx.events);
        inputScopes.push('admin');
        expect(result.document.scopes).toEqual(['read']);
    });
});
describe('handleServicePrincipalSetScopes', function () {
    it('updates scopes and emits ServicePrincipalScopesChanged', async function () {
        const fx = newFixture();
        const sp = await seedSp(fx, ['read']);
        const result = await handleServicePrincipalSetScopes({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            spId: sp.spId,
            scopes: ['read', 'write', 'delete'],
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.ServicePrincipalScopesChanged');
        expect(result.document.scopes).toEqual(['read', 'write', 'delete']);
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `ServicePrincipal:${sp.spId}`,
        ]);
    });
    it('rejects unknown spId with SERVICE_PRINCIPAL_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleServicePrincipalSetScopes({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            spId: 'sp-fake',
            scopes: ['read'],
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.SERVICE_PRINCIPAL_NOT_FOUND,
        });
        expect(fx.events.events).toHaveLength(0);
    });
    it('throws IdentityError', async function () {
        const fx = newFixture();
        await expect(handleServicePrincipalSetScopes({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            spId: 'sp-fake',
            scopes: [],
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
describe('handleServicePrincipalDisable', function () {
    it('flips status to disabled and stamps disabledAt + disabledBy', async function () {
        const fx = newFixture();
        const sp = await seedSp(fx);
        const result = await handleServicePrincipalDisable({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            spId: sp.spId,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.ServicePrincipalDisabled');
        expect(result.document.status).toBe('disabled');
        expect(result.document.disabledAt).toBeDefined();
        expect(result.document.disabledBy).toBe('admin');
    });
    it('omits disabledBy when principalId is null', async function () {
        const fx = newFixture();
        const sp = await seedSp(fx);
        const result = await handleServicePrincipalDisable({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            spId: sp.spId,
        }, fx.events, fx.entities);
        expect(result.document.disabledBy).toBeUndefined();
    });
    it('rejects unknown spId with SERVICE_PRINCIPAL_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleServicePrincipalDisable({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            spId: 'sp-fake',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.SERVICE_PRINCIPAL_NOT_FOUND,
        });
    });
});
describe('ServicePrincipal trio — tenant scoping', function () {
    it('SP in tenant B is invisible to tenant A operations', async function () {
        const fx = newFixture('tenant-a');
        const inB = await handleServicePrincipalCreate({
            tenantId: 'tenant-b',
            correlationId: 's',
            principalId: 'admin-b',
            ownerUserId: 'owner-b',
            displayName: 'cross',
            scopes: ['read'],
        }, fx.events);
        await dispatchAll(fx);
        await expect(handleServicePrincipalSetScopes({
            tenantId: 'tenant-a',
            correlationId: 'cross',
            principalId: 'admin-a',
            spId: inB.document.spId,
            scopes: ['read', 'admin'],
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.SERVICE_PRINCIPAL_NOT_FOUND,
        });
    });
});
