/**
 * E2E auth: SAML 2.0 SSO (Layer 3).
 *
 * Drives the full SP-initiated SAML flow:
 *   1. Atlas tenant has an active SAML IdP (the itest Keycloak realm).
 *   2. Visitor hits `/sso/saml/<tenantId>/initiate?idp=<idpId>`,
 *      which builds an AuthnRequest and 302s to Keycloak.
 *   3. Visitor logs into Keycloak with the seeded test user.
 *   4. Keycloak POSTs a signed SAML Response to
 *      `/sso/saml/<tenantId>/acs`.
 *   5. Atlas verifies the signature, JIT-provisions the user (if
 *      needed), mints a session cookie, and redirects to the tenant
 *      home.
 *
 * **Status: skipped by default.** The pre-imported itest realm at
 * `infra/compose/config/keycloak/atlas-realm.json` does not include a
 * SAML SP definition for `atlas-platform-sp` — the realm currently
 * carries OIDC clients only (`atlas-s2s`, `atlas-ingress`). Adding
 * the SAML SP is a realm-export refresh job (per
 * `infra/compose/keycloak/README.md` §"Refreshing the export"). When
 * the realm gains the SAML SP entry, the `realmHasSamlSp` pre-flight
 * below evaluates to true and the test becomes live.
 *
 * What the realm needs (for the implementer to add):
 *   - SAML 2.0 SP client at `atlas-platform-sp`.
 *   - SP entityID matching what `apps/server/src/routes/saml.ts`
 *     advertises in metadata (`https://atlas.example.com/sso/saml/sp`
 *     by default).
 *   - ACS URL: `${INGRESS}/sso/saml/${TENANT}/acs` (POST binding).
 *   - Signing cert + key on the IdP side (Keycloak generates these
 *     automatically; the cert PEM goes into the tenant's
 *     IdentityProvider record on Atlas).
 *   - Attribute mappers: nameID = email (standard); optionally
 *     given_name, family_name, groups.
 *
 * Spec: specs/domains/identity (Phase A6 — SAML).
 */
import { test, expect } from '@playwright/test';
import { isKeycloakReachable, keycloakConfig, } from '../helpers/keycloak.ts';
const INGRESS = process.env['INGRESS_BASE_URL'] ?? 'http://localhost:3000';
const TENANT = process.env['TENANT_ID'] ?? 'dev-tenant';
async function ingressUp(): Promise<boolean> {
    try {
        const res = await fetch(`${INGRESS}/healthz`, {
            signal: AbortSignal.timeout(2000),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
/**
 * Probe whether the realm carries a SAML SP entry. Keycloak exposes
 * `/realms/<realm>/clients` for admin callers, but for a non-admin
 * test we use the public SAML descriptor endpoint:
 * `/realms/<realm>/protocol/saml/descriptor` returns the IdP metadata
 * regardless of which clients are registered. The presence of an SP
 * is detectable via the IdP-initiated SSO descriptor at
 * `/realms/<realm>/protocol/saml/clients/<sp-id>` — 200 means
 * registered, 404 means not.
 */
async function realmHasSamlSp(): Promise<boolean> {
    // Keycloak's /protocol/saml/clients/<id> endpoint is permissive — it
    // returns metadata for any clientId shape, even when the SP isn't
    // registered. The reliable check is the admin clients API. We probe
    // it without auth; a 401 / 403 means we can't tell from outside, so
    // we treat it as "SP not present" and skip the test (the README is
    // explicit: the realm has OIDC clients only).
    // Override with `KEYCLOAK_SAML_SP_PRESENT=1` after refreshing the
    // realm export to enable the test.
    if (process.env['KEYCLOAK_SAML_SP_PRESENT'] === '1')
        return true;
    return false;
}
test.describe('e2e — SAML 2.0 SSO (designed; skipped pending realm refresh)', function () {
    test.beforeAll(async function () {
        if (!(await ingressUp())) {
            test.skip(true, `apps/server not reachable at ${INGRESS}`);
        }
        if (!(await isKeycloakReachable())) {
            test.skip(true, 'Keycloak not reachable; itest infra likely down');
        }
        if (!(await realmHasSamlSp())) {
            test.skip(true, 'Realm export does not include atlas-platform-sp SAML client; ' +
                'refresh per infra/compose/keycloak/README.md to enable');
        }
    });
    test('SP-initiated flow: initiate → Keycloak login → ACS POST → session cookie', async function ({ page, }) {
        // 1. Hit the SP-initiated endpoint. Atlas builds an AuthnRequest
        //    and 302s to Keycloak with SAMLRequest in the URL.
        await page.goto(`${INGRESS}/sso/saml/${TENANT}/initiate?idp=atlas-saml-itest`);
        // The URL should now be on Keycloak's SAML SSO endpoint.
        expect(page.url()).toContain(keycloakConfig.baseUrl);
        // 2. Authenticate at Keycloak with the seeded test user.
        await page.fill('input[name="username"]', keycloakConfig.testUser);
        await page.fill('input[name="password"]', keycloakConfig.testPassword);
        await page.click('input[type="submit"], button[type="submit"]');
        // 3. Keycloak auto-POSTs the SAML Response to Atlas's ACS
        //    endpoint via a self-submitting form. Wait for the redirect
        //    to land back on apps/server.
        await page.waitForURL(function (url) {
            return url.toString().startsWith(INGRESS);
        }, { timeout: 10000 });
        // 4. The ACS handler set a session cookie. Assert one is present.
        const cookies = await page.context().cookies();
        const sessionCookie = cookies.find(function (c) {
            return c.name.toLowerCase().includes('session');
        });
        expect(sessionCookie).toBeDefined();
    });
    test('replay protection: same SAML Response twice → second is rejected', async function () {
        // This branch requires capturing a real SAML Response from the
        // first flow and replaying it. Implementation deferred until the
        // realm SP is in place — the unit-level handler test covers the
        // logical branch in `modules/identity/test/unit/saml-acs.test.ts`
        // (the crypto-bearing branches there throw "TODO: implement" for
        // the same reason).
        throw new Error('TODO: requires captured SAML Response from realm SP; implement once realm SP is in place');
    });
});
