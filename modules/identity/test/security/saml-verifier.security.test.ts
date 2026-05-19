/**
 * SAML verifier — adversarial security tests.
 *
 * Each test in this file demonstrates a CONCRETE security gap in
 * `modules/identity/src/saml/verify.ts`. They are RED today — they
 * exercise an attacker-shaped payload that the verifier currently
 * accepts but should reject. As fixes land, individual tests flip
 * to GREEN; the file as a whole is the regression suite for SAML
 * security posture.
 *
 * Findings audit reference (cited per-test):
 *   F-SAML-2  No signature-algorithm whitelist (SHA-1 accepted)
 *   F-SAML-5  Top-level <Issuer> pin bypassed when element absent
 *   F-SAML-11 Audience check skipped when AudienceRestriction absent
 *   F-SAML-12 SubjectConfirmationData/@Recipient never checked
 *   F-SAML-6  Replay record is non-atomic (TOCTOU race)
 *
 * Findings F-SAML-1 (XSW), F-SAML-3 (comment splice), F-SAML-4
 * (InResponseTo), and F-SAML-16 (KeyInfo cert hijack) have separate
 * tests pending — they require more elaborate XML manipulation that
 * belongs in a follow-up slice once the architectural rewrite (extract
 * claims from canonicalized signed bytes) is scoped.
 */
import { describe, it, expect, beforeAll } from '@atlas/test';
import { verifySamlResponse, type VerifyOptions } from '../../src/index.ts';
import { buildSamlResponseXml, generateTestIdpKey, newReplayChecker, signResponse, type TestKeyPair, } from './helpers.ts';
const IDP_ISSUER = 'https://idp.example.com';
const SP_ENTITY_ID = 'https://atlas.example.com/sp';
/**
 * Vitest's asymmetric matchers (`expect.stringMatching`, etc.) are
 * declared as `any` on the runtime type. Hoisting the matcher behind a
 * typed `unknown`-returning factory keeps the test bodies free of the
 * `no-unsafe-assignment` violation when the matcher is dropped into a
 * `toMatchObject` shape literal.
 */
function samlErrorCodeMatcher(): unknown {
    return expect.stringMatching(/^SAML_/);
}
// One keypair per suite — gen is ~1s; reusing keeps the suite under a few sec.
let idp: TestKeyPair;
beforeAll(function () {
    idp = generateTestIdpKey('test-idp');
});
function baseVerifyOpts(overrides: Partial<VerifyOptions> = {}): VerifyOptions {
    return {
        idpCertPem: idp.certPem,
        spEntityId: SP_ENTITY_ID,
        expectedIdpIssuer: IDP_ISSUER,
        recordSeenAssertion: newReplayChecker().check,
        ...overrides,
    };
}
/* -------------------------------------------------------------------------- */
/* Sanity: a legitimate signed Response verifies cleanly.                     */
/* This test SHOULD pass today. If it fails, the helper is broken — fix it    */
/* before reading anything into the failing-by-design tests below.            */
/* -------------------------------------------------------------------------- */
describe('SAML verifier — sanity (must pass)', function () {
    it('accepts a properly-signed Response from the pinned IdP', async function () {
        const xml = buildSamlResponseXml({
            idpIssuer: IDP_ISSUER,
            spEntityId: SP_ENTITY_ID,
            nameId: 'alice@example.com',
        });
        const signedXml = signResponse(xml, {
            privateKeyPem: idp.privateKeyPem,
            certPem: idp.certPem,
        });
        const result = await verifySamlResponse(signedXml, baseVerifyOpts());
        expect(result.nameId).toBe('alice@example.com');
    });
});
/* -------------------------------------------------------------------------- */
/* F-SAML-2  No signature-algorithm whitelist                                 */
/*                                                                            */
/* xml-crypto 6.x accepts rsa-sha1 by default. The verifier never            */
/* constrains `signatureAlgorithm`, so an IdP signing with SHA-1 (or         */
/* an attacker who can swap the IdP cert) will be accepted.                  */
/*                                                                            */
/* Expected: verifier rejects SHA-1-signed payloads.                          */
/* Today:    verifier accepts them — this test is RED.                       */
/* -------------------------------------------------------------------------- */
describe('SAML verifier — F-SAML-2 algorithm whitelist', function () {
    it('rejects a Response signed with rsa-sha1', async function () {
        const xml = buildSamlResponseXml();
        const signedXml = signResponse(xml, {
            privateKeyPem: idp.privateKeyPem,
            certPem: idp.certPem,
            signatureAlgorithm: 'sha1',
            digestAlgorithm: 'sha1',
        });
        await expect(verifySamlResponse(signedXml, baseVerifyOpts())).rejects.toMatchObject({
            // Either SAML_SIGNATURE_INVALID or a new SAML_ALGORITHM_DISALLOWED
            // is acceptable — what's NOT acceptable is success.
            code: samlErrorCodeMatcher(),
        });
    });
});
/* -------------------------------------------------------------------------- */
/* F-SAML-5  Top-level Issuer pin is bypassed when <Issuer> is absent        */
/*                                                                            */
/* `verify.ts:145-152` only checks the Issuer when the element exists.       */
/* An attacker who can suppress the top-level <Issuer> element bypasses      */
/* the pin against the configured IdP entity ID.                              */
/*                                                                            */
/* Expected: missing top-level Issuer is rejected.                            */
/* Today:    silently passes — RED.                                          */
/* -------------------------------------------------------------------------- */
describe('SAML verifier — F-SAML-5 issuer pin', function () {
    it('rejects a Response with no top-level <Issuer> element', async function () {
        const xml = buildSamlResponseXml({ omitTopLevelIssuer: true });
        const signedXml = signResponse(xml, {
            privateKeyPem: idp.privateKeyPem,
            certPem: idp.certPem,
        });
        await expect(verifySamlResponse(signedXml, baseVerifyOpts())).rejects.toMatchObject({ code: samlErrorCodeMatcher() });
    });
});
/* -------------------------------------------------------------------------- */
/* F-SAML-11 Audience check is skipped when AudienceRestriction is absent    */
/*                                                                            */
/* `verify.ts:227` only enforces the audience match when                     */
/* `audiences.length > 0`. An assertion with no <AudienceRestriction>        */
/* slips through, letting one SP's session token be replayed against         */
/* another SP that trusts the same IdP.                                       */
/*                                                                            */
/* Expected: missing AudienceRestriction is rejected.                         */
/* Today:    silently passes — RED.                                          */
/* -------------------------------------------------------------------------- */
describe('SAML verifier — F-SAML-11 audience pin', function () {
    it('rejects an assertion with no <AudienceRestriction>', async function () {
        const xml = buildSamlResponseXml({ omitAudienceRestriction: true });
        const signedXml = signResponse(xml, {
            privateKeyPem: idp.privateKeyPem,
            certPem: idp.certPem,
        });
        await expect(verifySamlResponse(signedXml, baseVerifyOpts())).rejects.toMatchObject({ code: samlErrorCodeMatcher() });
    });
});
/* -------------------------------------------------------------------------- */
/* F-SAML-12 SubjectConfirmationData/@Recipient is never validated           */
/*                                                                            */
/* SAML 2.0 core REQUIRES that the SP verify                                  */
/* SubjectConfirmation/SubjectConfirmationData/@Recipient equals its own     */
/* ACS URL. The verifier currently does not look at this attribute at all.   */
/* Result: an assertion intended for SP-A's ACS can be replayed against      */
/* SP-B's ACS.                                                                */
/*                                                                            */
/* Expected: Recipient mismatch is rejected.                                  */
/* Today:    accepted — RED.                                                 */
/* -------------------------------------------------------------------------- */
describe('SAML verifier — F-SAML-12 SubjectConfirmation Recipient', function () {
    it('rejects an assertion whose SubjectConfirmationData/@Recipient is wrong', async function () {
        const xml = buildSamlResponseXml({
            subjectConfirmationRecipient: 'https://attacker.example.com/saml/acs',
        });
        const signedXml = signResponse(xml, {
            privateKeyPem: idp.privateKeyPem,
            certPem: idp.certPem,
        });
        // Caller-supplied SP ACS URL — the verifier needs a way to know what
        // its own ACS is. Until that arg is added, this test stays RED on
        // the missing check. (After the fix the verifier MUST accept some
        // form of `expectedAcsUrl` and assert against Recipient.)
        await expect(verifySamlResponse(signedXml, baseVerifyOpts())).rejects.toMatchObject({ code: samlErrorCodeMatcher() });
    });
});
/* -------------------------------------------------------------------------- */
/* F-SAML-6  Replay record is non-atomic (TOCTOU race)                       */
/*                                                                            */
/* The replay checker today does `get → if-exists-throw → put`. Two           */
/* concurrent ACS posts of the same assertion can both pass the `get`        */
/* and both be accepted. We model the race here in-memory: a checker         */
/* that yields between read and write — the kind of interleaving you'd       */
/* see under real DB latency.                                                 */
/*                                                                            */
/* Expected: only ONE of the two parallel verifies succeeds; the other       */
/*           sees alreadySeen=true and throws SAML_REPLAY_DETECTED.           */
/* Today:    BOTH succeed — RED.                                             */
/*                                                                            */
/* This test exercises the `recordSeenAssertion` contract, not the           */
/* verifier itself. It documents the race the production replay store        */
/* must close.                                                                */
/* -------------------------------------------------------------------------- */
describe('SAML verifier — F-SAML-6 replay atomicity', function () {
    it('rejects the second of two parallel verifies of the same assertion', async function () {
        const xml = buildSamlResponseXml({ assertionId: '_replay-target' });
        const signedXml = signResponse(xml, {
            privateKeyPem: idp.privateKeyPem,
            certPem: idp.certPem,
        });
        // Race-prone replay checker that mirrors the current
        // get-then-put pattern WITHOUT atomicity. A real Postgres-backed
        // implementation needs a unique index on (tenantId, assertionId)
        // and treat duplicate-key-violation as alreadySeen=true.
        const seen = new Set<string>();
        const racingChecker = async function (id: string, _expiresAt: string): Promise<{
            alreadySeen: boolean;
        }> {
            const exists = seen.has(id);
            // Yield to the event loop — simulates DB round-trip between
            // `get` and `put`. Both fibers see exists=false and proceed.
            await Promise.resolve();
            if (exists)
                return { alreadySeen: true };
            seen.add(id);
            return { alreadySeen: false };
        };
        const opts = baseVerifyOpts({ recordSeenAssertion: racingChecker });
        const [a, b] = await Promise.allSettled([
            verifySamlResponse(signedXml, opts),
            verifySamlResponse(signedXml, opts),
        ]);
        const fulfilled = [a, b].filter(function (r) {
            return r.status === 'fulfilled';
        });
        expect(fulfilled.length).toBe(1);
    });
});
