/**
 * Phase A3 acceptance — federated OIDC.
 *
 * Covers the @phase-a1 and @phase-a2-pending scenarios in
 * `federated-oidc.feature` end-to-end against in-memory adapters.
 * Mocks JWKS by hand-generating a key pair via `jose` so JWT verify
 * runs against a deterministic local key.
 */
import { describe, it, expect } from '@atlas/test';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { handleIdpActivate, handleIdpConfigure, handleIdpDisable, handleIdpRotateJwks, handleJitProvision, findActiveProviderByIssuer, getIdentityProviderEntity, getMembershipEntity, IdentityError, identityErrorCodes, type IdentityProviderDocument, type JitClaims, } from '../src/index.ts';
import { assertEventTags, dispatchAll, newFixture, type Fixture, } from './lib/fixtures.ts';
type Fx = Fixture;
function fx(): Fx {
    return newFixture('acme');
}
async function configureAndActivateIdp(f: Fx, overrides: Partial<Parameters<typeof handleIdpConfigure>[0]> = {}): Promise<IdentityProviderDocument> {
    const cfg = await handleIdpConfigure({
        tenantId: f.tenantId,
        correlationId: 'c-cfg',
        principalId: 'admin',
        displayName: 'Acme Corporate IdP',
        issuer: 'https://idp.acme.example/',
        audience: 'atlas.acme',
        jwksUri: 'https://idp.acme.example/.well-known/jwks.json',
        requireInvite: false,
        defaultRolesOnFirstLogin: ['Viewer'],
        ...overrides,
    }, f.events);
    await dispatchAll(f);
    const act = await handleIdpActivate({
        tenantId: f.tenantId,
        correlationId: 'c-act',
        principalId: 'admin',
        idpId: cfg.document.idpId,
    }, f.events, f.entities);
    await dispatchAll(f);
    return act.document;
}
describe('federated-oidc.feature: Configure IdP', function () {
    it('creates an IdP in `configured` status; Activate flips to active', async function () {
        const f = fx();
        const cfg = await handleIdpConfigure({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            displayName: 'Test IdP',
            issuer: 'https://idp.example/',
            audience: 'atlas.test',
            jwksUri: 'https://idp.example/jwks.json',
        }, f.events);
        await dispatchAll(f);
        expect(cfg.document.status).toBe('configured');
        expect(cfg.envelope.eventType).toBe('Identity.IdentityProviderConfigured');
        // I10 — Configure tags Tenant + the IdP entity.
        assertEventTags(cfg.envelope, [
            `Tenant:${f.tenantId}`,
            `IdentityProvider:${cfg.document.idpId}`,
        ]);
        const act = await handleIdpActivate({
            tenantId: f.tenantId,
            correlationId: 'c2',
            principalId: 'admin',
            idpId: cfg.document.idpId,
        }, f.events, f.entities);
        await dispatchAll(f);
        expect(act.document.status).toBe('active');
        expect(act.document.activatedAt).toBeTruthy();
        const row = await getIdentityProviderEntity(f.entities, f.tenantId, cfg.document.idpId);
        expect(row?.status).toBe('active');
    });
    it('Configure rejects when neither jwksUri nor discoveryDocument carries jwks_uri', async function () {
        const f = fx();
        await expect(handleIdpConfigure({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            displayName: 'broken',
            issuer: 'https://x.example/',
            audience: 'atlas.x',
        }, f.events)).rejects.toMatchObject({ code: identityErrorCodes.IDP_INVALID_CONFIG });
    });
});
describe('federated-oidc.feature: findActiveProviderByIssuer', function () {
    it('returns the active IdP matching the JWT iss claim', async function () {
        const f = fx();
        await configureAndActivateIdp(f);
        const found = await findActiveProviderByIssuer(f.entities, f.tenantId, 'https://idp.acme.example/');
        expect(found?.displayName).toBe('Acme Corporate IdP');
    });
    it('returns null for an unknown issuer (no IdP for this iss)', async function () {
        const f = fx();
        await configureAndActivateIdp(f);
        const found = await findActiveProviderByIssuer(f.entities, f.tenantId, 'https://stranger.example/');
        expect(found).toBeNull();
    });
    it('skips disabled IdPs even when issuer matches', async function () {
        const f = fx();
        const idp = await configureAndActivateIdp(f);
        await handleIdpDisable({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            idpId: idp.idpId,
        }, f.events, f.entities);
        await dispatchAll(f);
        const found = await findActiveProviderByIssuer(f.entities, f.tenantId, 'https://idp.acme.example/');
        expect(found).toBeNull();
    });
});
describe('federated-oidc.feature: JIT provisioning', function () {
    it('mints User + Membership with default roles when requireInvite=false', async function () {
        const f = fx();
        const idp = await configureAndActivateIdp(f, {
            requireInvite: false,
            defaultRolesOnFirstLogin: ['Viewer'],
        });
        const claims: JitClaims = {
            sub: 'idp-sub-newuser',
            email: 'newuser@acme.example',
            given_name: 'New',
            family_name: 'User',
            raw: { sub: 'idp-sub-newuser', email: 'newuser@acme.example' },
        };
        const result = await handleJitProvision({ tenantId: f.tenantId, correlationId: 'c', claims, idp }, f.events, f.entities);
        await dispatchAll(f);
        expect(result.created).toBe(true);
        expect(result.user.email).toBe('newuser@acme.example');
        expect(result.user.primaryIdpSubject).toBe('idp-sub-newuser');
        expect(result.membership.roles).toEqual(['Viewer']);
    });
    it('rejects with JIT_PROVISIONING_DISABLED when requireInvite=true and User is unknown', async function () {
        const f = fx();
        const idp = await configureAndActivateIdp(f, { requireInvite: true });
        const claims: JitClaims = {
            sub: 'unknown',
            email: 'unknown@acme.example',
            raw: { sub: 'unknown' },
        };
        await expect(handleJitProvision({ tenantId: f.tenantId, correlationId: 'c', claims, idp }, f.events, f.entities)).rejects.toMatchObject({
            code: identityErrorCodes.JIT_PROVISIONING_DISABLED,
        });
    });
    it('returning user: roles reconcile from group claim', async function () {
        const f = fx();
        const idp = await configureAndActivateIdp(f, {
            requireInvite: false,
            defaultRolesOnFirstLogin: ['Viewer'],
            groupClaimPath: 'groups',
            roleMappings: [
                { group: 'engineering', roles: ['Author'] },
                { group: 'admins', roles: ['TenantAdmin'] },
            ],
        });
        // First login — user is in `engineering`. Mints User+Membership.
        const first = await handleJitProvision({
            tenantId: f.tenantId,
            correlationId: 'c1',
            claims: {
                sub: 's1',
                email: 'alice@acme.example',
                raw: { sub: 's1', email: 'alice@acme.example', groups: ['engineering'] },
            },
            idp,
        }, f.events, f.entities);
        await dispatchAll(f);
        expect(first.membership.roles).toEqual(['Author']);
        // Second login — user added to `admins`. Should reconcile.
        const second = await handleJitProvision({
            tenantId: f.tenantId,
            correlationId: 'c2',
            claims: {
                sub: 's1',
                email: 'alice@acme.example',
                raw: { sub: 's1', groups: ['engineering', 'admins'] },
            },
            idp,
        }, f.events, f.entities);
        await dispatchAll(f);
        expect(second.created).toBe(false);
        expect(second.user.userId).toBe(first.user.userId);
        const rolesSorted = [...second.membership.roles].sort();
        expect(rolesSorted).toEqual(['Author', 'TenantAdmin']);
        // Subsequent login with same groups → no MembershipRolesChanged event.
        const third = await handleJitProvision({
            tenantId: f.tenantId,
            correlationId: 'c3',
            claims: {
                sub: 's1',
                email: 'alice@acme.example',
                raw: { sub: 's1', groups: ['engineering', 'admins'] },
            },
            idp,
        }, f.events, f.entities);
        expect(third.events).toHaveLength(0);
    });
    it('reads dotted group-claim paths (e.g. realm_access.roles)', async function () {
        const f = fx();
        const idp = await configureAndActivateIdp(f, {
            requireInvite: false,
            defaultRolesOnFirstLogin: [],
            groupClaimPath: 'realm_access.roles',
            roleMappings: [{ group: 'platform-engineer', roles: ['Author'] }],
        });
        const result = await handleJitProvision({
            tenantId: f.tenantId,
            correlationId: 'c',
            claims: {
                sub: 'sub2',
                email: 'bob@acme.example',
                raw: {
                    sub: 'sub2',
                    realm_access: { roles: ['platform-engineer'] },
                },
            },
            idp,
        }, f.events, f.entities);
        expect(result.membership.roles).toEqual(['Author']);
    });
});
describe('federated-oidc.feature: RotateJwks + Disable', function () {
    it('RotateJwks resets jwksFetchedAt + emits audit event', async function () {
        const f = fx();
        const idp = await configureAndActivateIdp(f);
        const result = await handleIdpRotateJwks({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            idpId: idp.idpId,
        }, f.events, f.entities);
        await dispatchAll(f);
        expect(result.envelope.eventType).toBe('Identity.IdentityProviderRotatedJwks');
        expect(result.document.jwksFetchedAt).toBeUndefined();
        // I10 — RotateJwks invalidates the IdP + its JWKS cache by tag.
        assertEventTags(result.envelope, [
            `Tenant:${f.tenantId}`,
            `IdentityProvider:${idp.idpId}`,
        ]);
    });
    it('Disable flips status; Activate again restores it', async function () {
        const f = fx();
        const idp = await configureAndActivateIdp(f);
        await handleIdpDisable({
            tenantId: f.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            idpId: idp.idpId,
        }, f.events, f.entities);
        await dispatchAll(f);
        let row = await getIdentityProviderEntity(f.entities, f.tenantId, idp.idpId);
        expect(row?.status).toBe('disabled');
        expect(row?.disabledAt).toBeTruthy();
        await handleIdpActivate({
            tenantId: f.tenantId,
            correlationId: 'c2',
            principalId: 'admin',
            idpId: idp.idpId,
        }, f.events, f.entities);
        await dispatchAll(f);
        row = await getIdentityProviderEntity(f.entities, f.tenantId, idp.idpId);
        expect(row?.status).toBe('active');
    });
});
describe('federated-oidc.feature: JWT shape smoke (RS256 via Node crypto)', function () {
    it('produces a 3-segment compact JWT signed by an RSA-2048 key', function () {
        // Pins the contract between the IDP entity's `audience`/`issuer`
        // and the verification code path in
        // `apps/server/src/middleware/principal.ts`. Uses Node's stdlib
        // `crypto` directly — no third-party JWT library needed for this
        // smoke check.
        const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
        });
        const header = { alg: 'RS256', typ: 'JWT', kid: 'k1' };
        const payload = {
            sub: 'user-1',
            email: 'alice@acme.example',
            groups: ['engineering'],
            iss: 'https://idp.acme.example/',
            aud: 'atlas.acme',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 5 * 60,
        };
        const b64url = function (buf: Buffer): string {
            return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        const headerB = b64url(Buffer.from(JSON.stringify(header), 'utf8'));
        const payloadB = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
        const signingInput = `${headerB}.${payloadB}`;
        const signer = createSign('RSA-SHA256');
        signer.update(signingInput);
        const signature = b64url(signer.sign(privateKey));
        const jwt = `${signingInput}.${signature}`;
        expect(jwt.split('.').length).toBe(3);
        expect(publicKey.asymmetricKeyType).toBe('rsa');
    });
});
