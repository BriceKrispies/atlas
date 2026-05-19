/**
 * Security-test helpers.
 *
 * Builds and signs synthetic SAML Responses against an ephemeral
 * RSA-2048 keypair so the verifier's adversarial branches can be
 * exercised without a real IdP. Mirrors what `node-saml`-style test
 * fixtures usually do, scoped to just what the failing tests need.
 *
 * The signing API is `xml-crypto` 6.x (the same library
 * `modules/identity/src/saml/verify.ts` uses for verification), so any
 * payload we sign here is byte-for-byte the kind of payload a
 * compliant IdP would emit.
 */
// `node-forge` is CJS; under Node ESM `import * as` only attaches `.default`.
// Use the default import so the call sites (`forge.pki.*`) keep working.
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
export interface TestKeyPair {
    privateKeyPem: string;
    certPem: string;
}
/**
 * Generate a fresh RSA-2048 self-signed cert for use as a SAML IdP
 * signing key. Slow (~1s on commodity hardware) — generate once per
 * suite when possible.
 */
export function generateTestIdpKey(commonName = 'test-idp'): TestKeyPair {
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 60000);
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const attrs = [
        { name: 'commonName', value: commonName },
        { name: 'organizationName', value: 'Atlas Test' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return {
        privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
        certPem: forge.pki.certificateToPem(cert),
    };
}
export interface BuildResponseOptions {
    /** SAML assertion ID. */
    assertionId?: string;
    /** SAML response ID. */
    responseId?: string;
    /** IdP entityID — used as Issuer. */
    idpIssuer?: string;
    /** SP entityID — used in AudienceRestriction. */
    spEntityId?: string;
    /** Subject NameID. */
    nameId?: string;
    /** When the assertion expires. */
    notOnOrAfter?: string;
    /** When the assertion becomes valid. */
    notBefore?: string;
    /** When `<Issuer>` should be omitted from the top-level <Response>. */
    omitTopLevelIssuer?: boolean;
    /** When `<AudienceRestriction>` should be omitted from <Conditions>. */
    omitAudienceRestriction?: boolean;
    /** When `<SubjectConfirmation>` should carry an attacker-controlled @Recipient. */
    subjectConfirmationRecipient?: string;
    /** When `<Conditions>` should be omitted entirely. */
    omitConditions?: boolean;
    /** Extra attributes to include in `<AttributeStatement>`. */
    extraAttributes?: Record<string, string>;
}
/**
 * Build the unsigned SAML Response XML body. The caller signs it with
 * `signResponse()`.
 */
export function buildSamlResponseXml(opts: BuildResponseOptions = {}): string {
    const assertionId = opts.assertionId ?? '_a1';
    const responseId = opts.responseId ?? '_r1';
    const idpIssuer = opts.idpIssuer ?? 'https://idp.example.com';
    const spEntityId = opts.spEntityId ?? 'https://atlas.example.com/sp';
    const nameId = opts.nameId ?? 'alice@victim.com';
    const notBefore = opts.notBefore ?? new Date(Date.now() - 60000).toISOString();
    const notOnOrAfter = opts.notOnOrAfter ?? new Date(Date.now() + 5 * 60000).toISOString();
    const recipient = opts.subjectConfirmationRecipient ?? 'https://atlas.example.com/saml/acs';
    const responseIssuer = opts.omitTopLevelIssuer
        ? ''
        : `<saml:Issuer>${idpIssuer}</saml:Issuer>`;
    const audienceXml = opts.omitAudienceRestriction
        ? ''
        : `<saml:AudienceRestriction><saml:Audience>${spEntityId}</saml:Audience></saml:AudienceRestriction>`;
    const conditionsXml = opts.omitConditions
        ? ''
        : `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">${audienceXml}</saml:Conditions>`;
    const extraAttrs = opts.extraAttributes
        ? Object.entries(opts.extraAttributes)
            .map(function ([n, v]) {
            return `<saml:Attribute Name="${n}"><saml:AttributeValue>${v}</saml:AttributeValue></saml:Attribute>`;
        })
            .join('')
        : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${responseId}"
  Version="2.0"
  IssueInstant="${new Date().toISOString()}">
  ${responseIssuer}
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${new Date().toISOString()}">
    <saml:Issuer>${idpIssuer}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${recipient}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    ${conditionsXml}
    <saml:AttributeStatement>
      <saml:Attribute Name="email"><saml:AttributeValue>${nameId}</saml:AttributeValue></saml:Attribute>
      ${extraAttrs}
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;
}
const SIG_ALGOS = {
    sha256: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    sha1: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
} as const;
const DIGEST_ALGOS = {
    sha256: 'http://www.w3.org/2001/04/xmlenc#sha256',
    sha1: 'http://www.w3.org/2000/09/xmldsig#sha1',
} as const;
export interface SignOptions {
    privateKeyPem: string;
    certPem: string;
    /** Defaults to sha256. */
    digestAlgorithm?: 'sha256' | 'sha1';
    /** Defaults to sha256. */
    signatureAlgorithm?: 'sha256' | 'sha1';
    /** Defaults to signing the <Assertion> element. */
    signAssertion?: boolean;
}
/**
 * Sign the response (or assertion) with the given key/cert. Returns
 * the signed XML string.
 */
export function signResponse(responseXml: string, opts: SignOptions): string {
    const signed = new SignedXml({
        privateKey: opts.privateKeyPem,
        publicCert: opts.certPem,
        signatureAlgorithm: SIG_ALGOS[opts.signatureAlgorithm ?? 'sha256'],
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    // Default: sign the <Assertion> element (typical IdP behavior).
    signed.addReference({
        xpath: "//*[local-name(.)='Assertion']",
        digestAlgorithm: DIGEST_ALGOS[opts.digestAlgorithm ?? 'sha256'],
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/2001/10/xml-exc-c14n#',
        ],
    });
    signed.computeSignature(responseXml, {
        location: { reference: "//*[local-name(.)='Assertion']", action: 'append' },
    });
    return signed.getSignedXml();
}
/**
 * Build, sign, and base64-encode a SAML Response in one shot — what
 * the verifier's `recordSeenAssertion` callback expects to receive.
 */
export function signedSamlBase64(buildOpts: BuildResponseOptions, signOpts: SignOptions): string {
    const xml = buildSamlResponseXml(buildOpts);
    return signResponse(xml, signOpts);
}
/**
 * In-memory replay-checker. Returns alreadySeen=true on second call
 * with the same id. Used as the `recordSeenAssertion` callback for
 * `verifySamlResponse`.
 */
export function newReplayChecker(): {
    check: (id: string, expiresAt: string) => Promise<{
        alreadySeen: boolean;
    }>;
    seen: Set<string>;
} {
    const seen = new Set<string>();
    return {
        seen,
        async check(id: string, _expiresAt: string) {
            if (seen.has(id))
                return { alreadySeen: true };
            seen.add(id);
            return { alreadySeen: false };
        },
    };
}
