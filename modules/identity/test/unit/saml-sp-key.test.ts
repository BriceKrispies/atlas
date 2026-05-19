/**
 * Unit tests for SAML SP-key handlers.
 *
 * Trio: `Identity.Saml.SpKey.{Generate,Rotate}`. These mint and rotate
 * the X.509 SP key pair used to sign SAML AuthnRequests / decrypt
 * IdP-encrypted assertions. The events carry tenant + key-id tags
 * (I10); rotation refuses on missing predecessors and on
 * already-rotated keys.
 *
 * Crypto branches (RSA keypair generation) are real — the handler
 * delegates to `node:crypto` via `generateSamlSpKey`. Tests use
 * smaller-than-default key lengths so they finish in seconds rather
 * than the ~30s a 4096-bit pair takes; the assertions are about
 * envelope shape + idempotency, not key strength.
 */
import { describe, it, expect } from 'vitest';
import { handleSamlSpKeyGenerate, handleSamlSpKeyRotate, IdentityError, identityErrorCodes, } from '../../src/index.ts';
import { assertEventTags, newFixture } from '../lib/fixtures.ts';
/**
 * Read the SamlSpKey document off an emitted event's payload with a
 * runtime structural check. Throws on a malformed envelope — that's a
 * test invariant failure. Centralises the per-shape narrowing so call
 * sites don't `as`-cast.
 */
function readSpKeyDocument(payload: unknown): {
    keyId: string;
    tenantId: string;
    status: 'active';
} {
    if (payload === null || typeof payload !== 'object') {
        throw new Error('expected payload to be an object');
    }
    const obj = (payload as {
        document?: unknown;
    }).document;
    if (obj === null || typeof obj !== 'object') {
        throw new Error('expected payload.document to be an object');
    }
    const candidate = obj as {
        keyId?: unknown;
        tenantId?: unknown;
        status?: unknown;
    };
    if (typeof candidate.keyId !== 'string' ||
        typeof candidate.tenantId !== 'string' ||
        candidate.status !== 'active') {
        throw new Error('expected payload.document to be an active SamlSpKey row');
    }
    return { keyId: candidate.keyId, tenantId: candidate.tenantId, status: 'active' };
}
describe('handleSamlSpKeyGenerate — happy path', function () {
    it('emits Identity.SamlSpKeyGenerated with Tenant + SamlSpKey tags (I10)', async function () {
        const fx = newFixture();
        const result = await handleSamlSpKeyGenerate({
            tenantId: fx.tenantId,
            correlationId: 'corr-gen',
            principalId: 'usr-admin',
            keyLength: 2048, // shortest path the API exposes; ~1s
        }, fx.events, fx.entities, fx.secrets);
        expect(result.envelope.eventType).toBe('Identity.SamlSpKeyGenerated');
        expect(result.document.status).toBe('active');
        assertEventTags(result.envelope, [
            `Tenant:${fx.tenantId}`,
            `SamlSpKey:${result.document.keyId}`,
        ]);
    });
});
describe('handleSamlSpKeyGenerate — failure: already-active key', function () {
    it('refuses when an active key already exists; first event remains the only one', async function () {
        const fx = newFixture();
        // Mint a first key so the second call sees an active predecessor.
        await handleSamlSpKeyGenerate({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'usr-admin',
            keyLength: 2048,
        }, fx.events, fx.entities, fx.secrets);
        // Persist the entity row by reading + putting (the handler does not
        // currently write the document into the entity store on Generate —
        // it only emits the event. Until a dispatcher runs, `findActiveSamlSpKey`
        // sees nothing. To exercise the guard we manually seed the active row.)
        const initial = fx.events.events[0];
        if (!initial) {
            throw new Error('expected one event after first SamlSpKey.Generate');
        }
        const doc = readSpKeyDocument(initial.payload);
        await fx.entities.put({
            tenantId: doc.tenantId,
            entityType: 'SamlSpKey',
            entityId: doc.keyId,
            attrs: doc,
            schemaVersion: 1,
        });
        await expect(handleSamlSpKeyGenerate({
            tenantId: fx.tenantId,
            correlationId: 'corr-2',
            principalId: 'usr-admin',
            keyLength: 2048,
        }, fx.events, fx.entities, fx.secrets)).rejects.toBeInstanceOf(IdentityError);
        // No new event was appended.
        expect(fx.events.events).toHaveLength(1);
    });
});
describe('handleSamlSpKeyRotate — failure: predecessor not found', function () {
    it('throws SAML_SP_KEY_NOT_FOUND with no events appended', async function () {
        const fx = newFixture();
        await expect(handleSamlSpKeyRotate({
            tenantId: fx.tenantId,
            correlationId: 'corr-rot',
            principalId: 'usr-admin',
            keyId: 'sks-nonexistent',
            keyLength: 2048,
        }, fx.events, fx.entities, fx.secrets)).rejects.toMatchObject({
            code: identityErrorCodes.SAML_SP_KEY_NOT_FOUND,
        });
        expect(fx.events.events).toHaveLength(0);
    });
});
