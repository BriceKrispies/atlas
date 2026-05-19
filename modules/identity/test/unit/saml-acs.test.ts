/**
 * Unit tests for `handleSamlAcs` (Layer 1, Identity Module Test Pass).
 *
 * SAML ACS is a thin handler over `verifySamlResponse` (crypto +
 * replay) and `handleJitProvision` (user provisioning). The unit-
 * testable surface is the handler's OWN logic:
 *   - Issuer parse from the unverified XML.
 *   - IdP lookup (matches by `samlEntityId` or `issuer`).
 *   - Pre-verify guards (IdP must be `kind=saml`, must have
 *     `samlIdpCert`).
 *
 * The crypto-bearing branches (signature verify, replay protection,
 * audience / lifetime / InResponseTo gating, attribute mapping → JIT
 * claims, end-to-end provisioning) live in Layer 3's
 * `tests/integration/auth/saml-sso.itest.ts`, against a real Keycloak
 * IdP. They CANNOT be unit-tested without standing up real test certs
 * and real signed XML, and mocking the crypto layer would make the
 * "unit" test theater. Those branches are present below as
 * `describe.skip` with explicit TODO references to the e2e file —
 * keeping them visible in the test report so the gap is auditable.
 */
import { describe, it, expect } from 'vitest';
import { handleSamlAcs, identityErrorCodes, IdentityError, type IdentityProviderDocument, } from '../../src/index.ts';
import { newFixture } from '../lib/fixtures.ts';
/**
 * Build a minimal base64-encoded SAML Response shell. Signature is
 * intentionally absent — these tests only reach the pre-verify
 * guards. Any test that proceeds past `verifySamlResponse` is in the
 * skipped block.
 */
function b64SamlShell(issuer: string | null): string {
    const issuerXml = issuer
        ? `<saml:Issuer>${issuer}</saml:Issuer>`
        : '';
    const xml = `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  ${issuerXml}
</samlp:Response>`;
    return Buffer.from(xml, 'utf8').toString('base64');
}
async function seedIdp(fx: ReturnType<typeof newFixture>, overrides: Partial<IdentityProviderDocument> = {}): Promise<IdentityProviderDocument> {
    const idp: IdentityProviderDocument = {
        idpId: overrides.idpId ?? 'idp-1',
        tenantId: fx.tenantId,
        kind: overrides.kind ?? 'saml',
        displayName: overrides.displayName ?? 'Test SAML IdP',
        issuer: overrides.issuer ?? 'https://idp.example.com',
        audience: overrides.audience ?? 'https://test.atlas.dev',
        requireInvite: overrides.requireInvite ?? false,
        defaultRolesOnFirstLogin: overrides.defaultRolesOnFirstLogin ?? [],
        roleMappings: overrides.roleMappings ?? [],
        priority: overrides.priority ?? 0,
        samlEntityId: overrides.samlEntityId ?? 'https://idp.example.com',
        status: overrides.status ?? 'active',
        createdAt: overrides.createdAt ?? new Date().toISOString(),
        updatedAt: overrides.updatedAt ?? new Date().toISOString(),
        ...overrides,
    };
    await fx.entities.put({
        tenantId: fx.tenantId,
        entityType: 'IdentityProvider',
        entityId: idp.idpId,
        attrs: idp,
    });
    return idp;
}
describe('handleSamlAcs — pre-verify branches', function () {
    it('rejects when the SAML Response has no <Issuer>', async function () {
        const fx = newFixture();
        await expect(handleSamlAcs({
            tenantId: fx.tenantId,
            correlationId: 'c',
            samlResponseB64: b64SamlShell(null),
            spEntityId: 'https://sp.atlas.example.com',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SAML_INVALID_RESPONSE });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects when the issuer matches no configured IdP', async function () {
        const fx = newFixture();
        await expect(handleSamlAcs({
            tenantId: fx.tenantId,
            correlationId: 'c',
            samlResponseB64: b64SamlShell('https://stranger.example.com'),
            spEntityId: 'https://sp.atlas.example.com',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SAML_INVALID_RESPONSE });
        expect(fx.events.events).toHaveLength(0);
    });
    it("rejects when the matching IdP exists but kind !== 'saml'", async function () {
        const fx = newFixture();
        await seedIdp(fx, {
            kind: 'oidc',
            issuer: 'https://oidc.example.com',
            samlEntityId: 'https://oidc.example.com',
        });
        await expect(handleSamlAcs({
            tenantId: fx.tenantId,
            correlationId: 'c',
            samlResponseB64: b64SamlShell('https://oidc.example.com'),
            spEntityId: 'https://sp.atlas.example.com',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SAML_INVALID_RESPONSE });
        expect(fx.events.events).toHaveLength(0);
    });
    it("rejects when the IdP exists but the IdP isn't active", async function () {
        const fx = newFixture();
        // Both query paths (samlEntityId match + findActiveProviderByIssuer)
        // filter on `status: 'active'`, so a disabled IdP looks like
        // "no IdP at all" — the same SAML_INVALID_RESPONSE error code.
        await seedIdp(fx, {
            idpId: 'idp-disabled',
            kind: 'saml',
            issuer: 'https://disabled.example.com',
            samlEntityId: 'https://disabled.example.com',
            status: 'disabled',
        });
        await expect(handleSamlAcs({
            tenantId: fx.tenantId,
            correlationId: 'c',
            samlResponseB64: b64SamlShell('https://disabled.example.com'),
            spEntityId: 'https://sp.atlas.example.com',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SAML_INVALID_RESPONSE });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects when the matching IdP is missing its samlIdpCert', async function () {
        const fx = newFixture();
        await seedIdp(fx, {
            kind: 'saml',
            issuer: 'https://no-cert.example.com',
            samlEntityId: 'https://no-cert.example.com',
            // samlIdpCert deliberately omitted
        });
        await expect(handleSamlAcs({
            tenantId: fx.tenantId,
            correlationId: 'c',
            samlResponseB64: b64SamlShell('https://no-cert.example.com'),
            spEntityId: 'https://sp.atlas.example.com',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SAML_INVALID_RESPONSE });
        expect(fx.events.events).toHaveLength(0);
    });
    it('throws IdentityError instances for every pre-verify rejection', async function () {
        const fx = newFixture();
        await expect(handleSamlAcs({
            tenantId: fx.tenantId,
            correlationId: 'c',
            samlResponseB64: b64SamlShell(null),
            spEntityId: 'https://sp.atlas.example.com',
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
describe('handleSamlAcs — tenant scoping', function () {
    it("an IdP in tenant B is invisible to a SAML ACS call in tenant A", async function () {
        const fx = newFixture('tenant-a');
        // Seed IdP in tenant B with the issuer the response will claim.
        await fx.entities.put({
            tenantId: 'tenant-b',
            entityType: 'IdentityProvider',
            entityId: 'idp-b',
            attrs: {
                idpId: 'idp-b',
                tenantId: 'tenant-b',
                kind: 'saml',
                displayName: 'Tenant B IdP',
                issuer: 'https://shared.example.com',
                audience: 'https://test.atlas.dev',
                requireInvite: false,
                defaultRolesOnFirstLogin: [],
                roleMappings: [],
                priority: 0,
                samlEntityId: 'https://shared.example.com',
                samlIdpCert: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----',
                status: 'active',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            } satisfies IdentityProviderDocument,
        });
        // ACS in tenant A. Tenant-scoped query returns no candidates →
        // SAML_INVALID_RESPONSE.
        await expect(handleSamlAcs({
            tenantId: 'tenant-a',
            correlationId: 'cross',
            samlResponseB64: b64SamlShell('https://shared.example.com'),
            spEntityId: 'https://sp.atlas.example.com',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SAML_INVALID_RESPONSE });
    });
});
describe.skip('handleSamlAcs — crypto-bearing branches (covered by Layer 3 e2e)', function () {
    // The branches below would require real test certs + real signed
    // XML. Mocking `verifySamlResponse` here would defeat the purpose of
    // a unit test (the test would assert what the mock does, not what
    // the handler does). They land in:
    //   tests/integration/auth/saml-sso.itest.ts
    // against a real Keycloak IdP, with full signature verification,
    // replay protection, audience matching, and InResponseTo binding.
    it.todo('happy path: verified assertion → SamlAssertionVerified event + JIT provision');
    it.todo('replay-protection: same assertionId twice → second rejected');
    it.todo('audience mismatch: response Audience != spEntityId → reject');
    it.todo('expectedInResponseTo: SP-initiated flow rejects mismatched InResponseTo');
    it.todo('attribute mapping: NameID + email + groups land in JIT claims');
    it.todo('SamlAssertionVerified envelope shape: cacheInvalidationTags include IdentityProvider:<id>');
    it.todo('JIT provision integration: emits UserCreated + MembershipCreated when user is new');
});
