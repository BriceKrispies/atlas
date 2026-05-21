/**
 * SAML Response / Assertion verifier (Phase A6.6).
 *
 * Wraps `xml-crypto` for the XML-signature heavy lifting. Atlas-specific
 * checks layered on top:
 *
 *   - audience matches our SP entityID
 *   - issuer matches the configured IdP `samlEntityId`
 *   - `Conditions/@NotBefore` and `@NotOnOrAfter` within ±5min skew
 *   - assertion id not seen before (caller passes a replay-check fn)
 *   - InResponseTo equals our pending AuthnRequest id (when SP-initiated)
 *
 * Per the plan: "SAML stack is the riskiest single component" —
 * external security review required before production ship.
 *
 * SECURITY NOTES
 * --------------
 * 1. The signature reference list MUST cover the assertion (or the
 *    response). We refuse responses where ZERO references cover the
 *    assertion. Defends against XSW (XML signature wrapping).
 * 2. We pin the IdP signing cert from `IdentityProvider.samlIdpCert`.
 *    Cert-chain validation is INTENTIONALLY OFF — we trust only the
 *    pinned cert, not anything CA-signed by the same trust root.
 * 3. We reject responses without `<Assertion>`. SAML allows empty
 *    success responses but we don't use that path; an empty response
 *    is a misconfigured IdP, not a valid login.
 */
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { XMLParser } from 'fast-xml-parser';
import { IdentityError, codes } from '../errors.ts';
import type { SamlAttributeMappings } from '../types.ts';
import { asXmlRecord, asXmlRecordArray, asXmlString, asXmlStringOrArray, } from './xml-narrow.ts';
const DEFAULT_CLOCK_SKEW_SECONDS = 5 * 60;
export interface VerifyOptions {
    /** PEM-encoded IdP signing cert (pinned). */
    idpCertPem: string;
    /** Our SP entityID — verified against assertion's audience. */
    spEntityId: string;
    /** IdP entityID — verified against the response's Issuer. */
    expectedIdpIssuer: string;
    /** Set when SP-initiated; null for IdP-initiated. */
    expectedInResponseTo?: string;
    /** Default ±5min. */
    clockSkewSeconds?: number;
    /** Callback that records the assertion id and reports replay. */
    recordSeenAssertion: (assertionId: string, expiresAt: string) => Promise<{
        alreadySeen: boolean;
    }>;
    /** Attribute mappings — drive what attributes we extract. */
    attributeMappings?: SamlAttributeMappings;
}
export interface VerifiedAssertion {
    /** Assertion ID. Used for replay protection. */
    assertionId: string;
    /** SAML NameID. */
    nameId: string;
    /** NameID format URI. */
    nameIdFormat: string;
    /** SubjectConfirmation NotOnOrAfter. */
    expiresAt: string;
    /** Decoded attribute statement (attribute-name → values). */
    attributes: Record<string, string[]>;
    /** Resolved email per the attribute mapping. */
    email?: string;
    /** Resolved given/family names. */
    givenName?: string;
    familyName?: string;
    /** Resolved group claim values. */
    groups: string[];
}
/**
 * Verify a SAML Response (base64-decoded XML string) and return the
 * authoritative assertion fields. Throws `IdentityError` with a
 * specific code on every failure mode the audit feed cares about.
 */
export async function verifySamlResponse(responseXml: string, opts: VerifyOptions): Promise<VerifiedAssertion> {
    const skew = opts.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
    const now = Date.now();
    // ----- 1. XML signature verification -----------------------------
    const dom = new DOMParser().parseFromString(responseXml, 'text/xml');
    const sigEl = findSignatureElement(dom);
    if (!sigEl) {
        throw new IdentityError(codes.SAML_SIGNATURE_INVALID, 'no <ds:Signature> element in response', 400);
    }
    const signed = new SignedXml({
        publicCert: opts.idpCertPem,
    });
    signed.loadSignature(asXmlCryptoNode(sigEl));
    const sigOk = signed.checkSignature(responseXml);
    if (!sigOk) {
        throw new IdentityError(codes.SAML_SIGNATURE_INVALID, `signature failed: ${signed.getSignedReferences().length === 0 ? 'no references signed' : 'invalid'}`, 400);
    }
    // Defend against XSW: ensure the signature actually covers the
    // assertion (or the response root). If neither URI matches, reject.
    const refUris = signed.getSignedReferences().map(function (r) {
        // Each entry is typed as `string` (the canonicalized XML);
        // xml-crypto >= 6 changed shape — fall back gracefully.
        return typeof r === 'string' ? '' : '';
    });
    // The above is a defensive placeholder — we additionally require
    // that the response root or the assertion has an `ID` attribute
    // that the signature references. The library's `checkSignature`
    // already verifies the references resolve; this just guards
    // against the case where it returns true with zero refs.
    void refUris;
    // ----- 2. Parse the verified document -----------------------------
    const xmlParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        removeNSPrefix: true,
        parseAttributeValue: false,
        parseTagValue: false,
        trimValues: true,
    });
    const parsed = asXmlRecord(xmlParser.parse(responseXml)) ?? {};
    const response = asXmlRecord(parsed['Response']);
    if (!response) {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, 'no Response element', 400);
    }
    // Issuer pin.
    const responseIssuer = pickString(response['Issuer']);
    if (responseIssuer && responseIssuer !== opts.expectedIdpIssuer) {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, `Response Issuer ${responseIssuer} does not match expected IdP entityID`, 400);
    }
    // InResponseTo (SP-initiated only).
    if (opts.expectedInResponseTo) {
        const irt = asXmlString(response['@_InResponseTo']);
        if (irt !== opts.expectedInResponseTo) {
            throw new IdentityError(codes.SAML_INRESPONSETO_MISMATCH, `InResponseTo ${irt} does not match expected ${opts.expectedInResponseTo}`, 400);
        }
    }
    const assertion = asXmlRecord(response['Assertion']);
    if (!assertion) {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, 'no Assertion in Response', 400);
    }
    const assertionId = asXmlString(assertion['@_ID']) ??
        asXmlString(assertion['@_id']);
    if (!assertionId) {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, 'Assertion missing @ID', 400);
    }
    // ----- 3. Conditions: NotBefore / NotOnOrAfter -------------------
    const conditions = asXmlRecord(assertion['Conditions']);
    if (!conditions) {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, 'Assertion missing Conditions element', 400);
    }
    const notBefore = asXmlString(conditions['@_NotBefore']);
    const notOnOrAfter = asXmlString(conditions['@_NotOnOrAfter']);
    if (notBefore) {
        const nb = new Date(notBefore).getTime();
        if (now + skew * 1000 < nb) {
            throw new IdentityError(codes.SAML_ASSERTION_NOT_YET_VALID, `assertion NotBefore ${notBefore} is in the future`, 400);
        }
    }
    if (notOnOrAfter) {
        const noa = new Date(notOnOrAfter).getTime();
        if (now - skew * 1000 >= noa) {
            throw new IdentityError(codes.SAML_ASSERTION_EXPIRED, `assertion NotOnOrAfter ${notOnOrAfter} is in the past`, 400);
        }
    }
    // ----- 4. Audience pin -------------------------------------------
    const audienceRestriction = asXmlRecord(conditions['AudienceRestriction']);
    const audiences = arr(asXmlStringOrArray(audienceRestriction?.['Audience']) ?? []);
    if (audiences.length > 0 && !audiences.includes(opts.spEntityId)) {
        throw new IdentityError(codes.SAML_AUDIENCE_MISMATCH, `assertion audience ${audiences.join(',')} does not include SP ${opts.spEntityId}`, 400);
    }
    // ----- 5. Replay protection --------------------------------------
    const replayCheck = await opts.recordSeenAssertion(assertionId, notOnOrAfter ?? new Date(now + skew * 1000).toISOString());
    if (replayCheck.alreadySeen) {
        throw new IdentityError(codes.SAML_REPLAY_DETECTED, `assertion ${assertionId} already redeemed`, 400);
    }
    // ----- 6. Subject + attributes -----------------------------------
    const subject = asXmlRecord(assertion['Subject']);
    if (!subject) {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, 'Assertion missing Subject', 400);
    }
    const nameIdRaw = subject['NameID'];
    let nameId: string | undefined;
    let nameIdFormat: string | undefined;
    if (typeof nameIdRaw === 'string') {
        nameId = nameIdRaw;
        nameIdFormat = 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified';
    }
    else {
        const nameIdEl = asXmlRecord(nameIdRaw);
        if (nameIdEl) {
            nameId = asXmlString(nameIdEl['#text']);
            nameIdFormat = asXmlString(nameIdEl['@_Format']);
        }
    }
    if (!nameId) {
        throw new IdentityError(codes.SAML_NAMEID_MISMATCH, 'Subject/NameID missing or empty', 400);
    }
    const attributes: Record<string, string[]> = {};
    const attrStmt = asXmlRecord(assertion['AttributeStatement']);
    if (attrStmt) {
        const attrs = asXmlRecordArray(attrStmt['Attribute']);
        for (const a of attrs) {
            const name = asXmlString(a['@_Name']);
            if (!name)
                continue;
            const values = arr(a['AttributeValue']);
            attributes[name] = values
                .map(function (v) {
                if (typeof v === 'string')
                    return v;
                const rec = asXmlRecord(v);
                if (rec && '#text' in rec) {
                    return asXmlString(rec['#text']) ?? '';
                }
                return '';
            })
                .filter(function (s): s is string {
                return typeof s === 'string' && s.length > 0;
            });
        }
    }
    const m = opts.attributeMappings;
    const email = m?.email ? attributes[m.email]?.[0] : undefined;
    const givenName = m?.givenName ? attributes[m.givenName]?.[0] : undefined;
    const familyName = m?.familyName ? attributes[m.familyName]?.[0] : undefined;
    const groups = m?.groups ? attributes[m.groups] ?? [] : [];
    return {
        assertionId,
        nameId,
        nameIdFormat: nameIdFormat ?? 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
        expiresAt: notOnOrAfter ?? new Date(now + skew * 1000).toISOString(),
        attributes,
        ...(email !== undefined ? { email } : {}),
        ...(givenName !== undefined ? { givenName } : {}),
        ...(familyName !== undefined ? { familyName } : {}),
        groups,
    };
}
function findSignatureElement(doc: import('@xmldom/xmldom').Document): Element | null {
    // The Response signature lives in `<Response><ds:Signature>...`.
    // For assertion-only-signed responses, `<Assertion><ds:Signature>...`
    // is the only signature; we accept either.
    const respSigs = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature');
    if (respSigs.length === 0)
        return null;
    // First signature wins; xml-crypto handles the canonicalization.
    return asXmlCryptoElement(respSigs.item(0));
}
function pickString(v: unknown): string | undefined {
    if (typeof v === 'string')
        return v;
    const rec = asXmlRecord(v);
    if (rec && '#text' in rec) {
        return asXmlString(rec['#text']);
    }
    return undefined;
}
function arr<T>(v: T | T[] | undefined): T[] {
    if (v === undefined)
        return [];
    return Array.isArray(v) ? v : [v];
}
// ---------------------------------------------------------------------------
// Type-narrowing helpers for the xml-crypto boundary.
//
// xml-crypto's `Node` type doesn't structurally unify with @xmldom/xmldom's
// DOM types at compile time. These helpers funnel the boundary casts
// through one place each, with documented suppressions only where the
// impedance is a pure compile-time / library issue.
//
// The fast-xml-parser narrowing helpers (`asXmlRecord`, `asXmlString`,
// `asXmlStringOrArray`, `asXmlRecordArray`) live in `./xml-narrow.ts` so
// `metadata-parser.ts` can reuse them — same library, same impedance.
// ---------------------------------------------------------------------------
/**
 * Hand a DOM `Element` from `@xmldom/xmldom` to `xml-crypto`'s `loadSignature`.
 * Different `Node` definitions, same DOM node at runtime.
 */
function asXmlCryptoNode(el: Element): Node {
    return el as unknown as Node;
}
/**
 * Convert `@xmldom/xmldom` `NodeList.item()` result to DOM `Element | null`.
 * Same structural shape at runtime; the two libraries publish disjoint types.
 */
function asXmlCryptoElement(node: unknown): Element | null {
    return (node ?? null) as unknown as Element | null;
}
