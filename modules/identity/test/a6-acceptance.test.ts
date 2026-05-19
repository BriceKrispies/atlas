/**
 * Phase A6 acceptance — SAML 2.0 (partial).
 *
 * Covers metadata parsing, AuthnRequest construction, SP key
 * generation, and the IdP metadata→Configure round-trip. The
 * full XML-signature verify path requires a mock IdP key + signed
 * SAML response fixture — deferred to a follow-up slice that pairs
 * with the external security review the plan flagged.
 */
import { describe, it, expect } from '@atlas/test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { Compression } from '@atlas/ports';
import { buildAuthnRequest, generateSamlSpKey, parseIdpMetadata, DEFAULT_SAML_ATTRIBUTE_MAPPINGS, identityErrorCodes, } from '../src/index.ts';
// Test-side Compression: tests are allowed to reach `node:zlib` for
// fixture wiring; the leak rule (ADR 0008) applies to source modules.
const compression: Compression = {
    async deflateRaw(input) {
        return deflateRawSync(input);
    },
    async inflateRaw(input) {
        return inflateRawSync(input);
    },
};
const MINIMAL_IDP_METADATA = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example/saml/metadata">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>MIIBfTCCASYCAQEwBwYFK4EEACIwGzEZMBcGA1UEAwwQQXRsYXMgVGVzdCBJ
ZHAwHhcNMjUwNTAxMDAwMDAwWhcNMzAwNTAxMDAwMDAwWjAbMRkwFwYDVQQD
DBBBdGxhcyBUZXN0IElkcDBaMA0GCSqGSIb3DQEBAQUAA0kAMEYCQQDPYR1k
QmVtaGGOTrYbFQyHvxnhhvkxWJVJBxYxX/9NjCBrlNWN7HfkXCgg7N9rWmYL
HTSWAW0WT0t8lz0EYi1ZAgMBAAEwDQYJKoZIhvcNAQELBQADQQAW3T+lKKRS
Sample==</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</NameIDFormat>
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example/saml/sso/redirect"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example/saml/sso/post"/>
    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example/saml/slo"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;
describe('saml.feature: parseIdpMetadata', function () {
    it('extracts entityID, SSO URL, signing cert, NameID format', function () {
        const parsed = parseIdpMetadata(MINIMAL_IDP_METADATA);
        expect(parsed.entityId).toBe('https://idp.example/saml/metadata');
        // Prefers POST binding over Redirect.
        expect(parsed.ssoUrl).toBe('https://idp.example/saml/sso/post');
        expect(parsed.sloUrl).toBe('https://idp.example/saml/slo');
        expect(parsed.signingCertPem).toMatch(/^-----BEGIN CERTIFICATE-----/);
        expect(parsed.signingCertPem).toMatch(/-----END CERTIFICATE-----\s*$/);
        // First declared NameIDFormat wins.
        expect(parsed.nameIdFormat).toBe('persistent');
    });
    it('rejects metadata missing EntityDescriptor', function () {
        expect(function () {
            return parseIdpMetadata('<NotMetadata/>');
        }).toThrow(expect.objectContaining({ code: identityErrorCodes.SAML_INVALID_METADATA }));
    });
    it('rejects metadata missing SingleSignOnService', function () {
        const xml = MINIMAL_IDP_METADATA.replace(/<SingleSignOnService\b[^>]*\/>/g, '');
        expect(function () {
            return parseIdpMetadata(xml);
        }).toThrow(expect.objectContaining({ code: identityErrorCodes.SAML_INVALID_METADATA }));
    });
    it('rejects metadata missing X509Certificate', function () {
        const xml = MINIMAL_IDP_METADATA.replace(/<KeyDescriptor[\s\S]*?<\/KeyDescriptor>/, '');
        expect(function () {
            return parseIdpMetadata(xml);
        }).toThrow(expect.objectContaining({ code: identityErrorCodes.SAML_INVALID_METADATA }));
    });
    it('falls back to Redirect when POST binding is absent', function () {
        const xml = MINIMAL_IDP_METADATA.replace(/<SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"[^>]*\/>/g, '');
        const parsed = parseIdpMetadata(xml);
        expect(parsed.ssoUrl).toBe('https://idp.example/saml/sso/redirect');
    });
});
describe('saml.feature: buildAuthnRequest', function () {
    it('produces a well-formed AuthnRequest XML with Issuer + ACS URL', async function () {
        const built = await buildAuthnRequest({
            spEntityId: 'https://atlas.example/sso/saml/acme',
            destination: 'https://idp.example/saml/sso/post',
            acsUrl: 'https://atlas.example/sso/saml/acme/acs',
        }, compression);
        expect(built.requestId).toMatch(/^_/);
        expect(built.xml).toContain('<samlp:AuthnRequest');
        expect(built.xml).toContain('xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"');
        expect(built.xml).toContain('<saml:Issuer>https://atlas.example/sso/saml/acme</saml:Issuer>');
        expect(built.xml).toContain('AssertionConsumerServiceURL="https://atlas.example/sso/saml/acme/acs"');
        expect(built.xml).toContain('Destination="https://idp.example/saml/sso/post"');
        // HTTP-Redirect binding params present.
        expect(built.redirectQueryParam).toMatch(/^SAMLRequest=/);
    });
    it('builds redirect URL with RelayState round-trip', async function () {
        const built = await buildAuthnRequest({
            spEntityId: 'https://atlas.example/sso/saml/acme',
            destination: 'https://idp.example/saml/sso',
            acsUrl: 'https://atlas.example/sso/saml/acme/acs',
        }, compression);
        const url = built.buildRedirectUrl('hello world');
        expect(url).toMatch(/^https:\/\/idp\.example\/saml\/sso\?SAMLRequest=/);
        expect(url).toContain('RelayState=hello%20world');
    });
    it('escapes XML metacharacters in entity ids', async function () {
        const built = await buildAuthnRequest({
            spEntityId: 'https://atlas.example/<evil>',
            destination: 'https://idp.example/saml/sso',
            acsUrl: 'https://atlas.example/acs',
        }, compression);
        expect(built.xml).not.toContain('<evil>');
        expect(built.xml).toContain('&lt;evil&gt;');
    });
});
describe('saml.feature: generateSamlSpKey', function () {
    it('produces a 2048-bit RSA key + self-signed cert', function () {
        const key = generateSamlSpKey({ commonName: 'atlas-sp:test' });
        expect(key.keyLength).toBe(2048);
        expect(key.privateKeyPem).toContain('BEGIN RSA PRIVATE KEY');
        expect(key.publicCertPem).toContain('BEGIN CERTIFICATE');
        expect(new Date(key.notAfter).getTime()).toBeGreaterThan(new Date(key.notBefore).getTime());
    });
});
describe('saml.feature: default attribute mappings', function () {
    it('points at the standard claim URIs (Microsoft / SAML conventions)', function () {
        expect(DEFAULT_SAML_ATTRIBUTE_MAPPINGS.email).toBe('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress');
        expect(DEFAULT_SAML_ATTRIBUTE_MAPPINGS.givenName).toBe('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname');
    });
});
