/**
 * SAML ACS (Assertion Consumer Service) handler — Phase A6.8 + part of A6.9.
 *
 * Pulls together the verifier, the IdP lookup, the replay-protection
 * entity, and JIT provisioning. The HTTP layer (Phase A6.9 routes)
 * is a thin shell over this handler.
 *
 * Flow:
 *   1. Decode the SAMLResponse (base64 → XML).
 *   2. Resolve the IdP from the response's Issuer (must match a
 *      configured IdentityProvider with kind=saml).
 *   3. Verify XML signature + audience + lifetime + replay.
 *   4. Build JIT claims from NameID + attributes per
 *      `samlAttributeMappings`.
 *   5. Reuse `handleJitProvision` to mint or reconcile User+Membership.
 */
import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { IdentityProviderDocument, MembershipDocument, UserDocument, } from '../types.ts';
import { newEventId } from '../ids.ts';
import { recordSeenAssertion } from '../entities/saml-assertion-replay.ts';
import { findActiveProviderByIssuer } from '../entities/identity-provider.ts';
import { verifySamlResponse, type VerifiedAssertion, } from '../saml/verify.ts';
import { DEFAULT_SAML_ATTRIBUTE_MAPPINGS, } from '../saml/metadata-parser.ts';
import { handleJitProvision } from './jit-provision.ts';
import type { JitClaims } from './jit-provision.ts';
export interface SamlAcsCommand {
    tenantId: string;
    correlationId: string;
    /** Base64-encoded SAML Response (typically from the form POST). */
    samlResponseB64: string;
    /** SP entityID — what we expect the audience to match. */
    spEntityId: string;
    /** Optional InResponseTo (set when SP-initiated). */
    expectedInResponseTo?: string;
    /** Optional principal id for the audit envelope. */
    principalId?: string | null;
}
export interface SamlAcsResult {
    envelope: EventEnvelope;
    follow: ReadonlyArray<EventEnvelope>;
    user: UserDocument;
    membership: MembershipDocument;
    /** The verified assertion contents. Useful for audit + downstream session. */
    assertion: VerifiedAssertion;
    /** The IdP that issued the assertion. */
    idp: IdentityProviderDocument;
}
export async function handleSamlAcs(cmd: SamlAcsCommand, eventStore: EventStore, entities: EntityStore): Promise<SamlAcsResult> {
    const xml = Buffer.from(cmd.samlResponseB64, 'base64').toString('utf8');
    // Pull the issuer from the unverified parse just to find the IdP;
    // signature verify pins to that IdP's cert immediately after.
    const issuerMatch = xml.match(/<(?:saml:)?Issuer[^>]*>([^<]+)<\/(?:saml:)?Issuer>/);
    const claimedIssuer = issuerMatch?.[1]?.trim() ?? null;
    if (!claimedIssuer) {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, 'no <Issuer> in SAML Response', 400);
    }
    // findActiveProviderByIssuer matches `IdentityProvider.issuer`,
    // which we use as the JWT iss for OIDC. For SAML the equivalent is
    // `samlEntityId`. We prefer `samlEntityId` when set, fall back to
    // `issuer` for IdPs that share the field.
    const candidates = await entities.query<IdentityProviderDocument>(cmd.tenantId, 'IdentityProvider', { attrsEqual: { samlEntityId: claimedIssuer, status: 'active' } });
    const idp = candidates[0]?.attrs ??
        (await findActiveProviderByIssuer(entities, cmd.tenantId, claimedIssuer));
    if (!idp || idp.kind !== 'saml') {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, `no SAML IdentityProvider for issuer ${claimedIssuer}`, 401);
    }
    if (!idp.samlIdpCert) {
        throw new IdentityError(codes.SAML_INVALID_RESPONSE, `IdentityProvider ${idp.idpId} missing samlIdpCert`, 500);
    }
    const mappings = idp.samlAttributeMappings ?? DEFAULT_SAML_ATTRIBUTE_MAPPINGS;
    const verified = await verifySamlResponse(xml, {
        idpCertPem: idp.samlIdpCert,
        spEntityId: cmd.spEntityId,
        expectedIdpIssuer: idp.samlEntityId ?? idp.issuer,
        ...(cmd.expectedInResponseTo !== undefined
            ? { expectedInResponseTo: cmd.expectedInResponseTo }
            : {}),
        attributeMappings: mappings,
        recordSeenAssertion: async function (assertionId, expiresAt) {
            return recordSeenAssertion(entities, cmd.tenantId, idp.idpId, assertionId, expiresAt);
        },
    });
    // Emit the verified-audit event regardless of downstream JIT
    // success — the event log records "we verified this assertion."
    const occurredAt = new Date().toISOString();
    const verifiedEvent: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Identity.SamlAssertionVerified',
        schemaId: 'domain.identity.saml.assertion_verified.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `identity.saml.verified.${verified.assertionId}`,
        causationId: null,
        principalId: cmd.principalId ?? null,
        userId: null,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `IdentityProvider:${idp.idpId}`,
        ],
        retentionTag: 'retention:1y',
        payload: {
            idpId: idp.idpId,
            assertionId: verified.assertionId,
            nameId: verified.nameId,
        },
    };
    const stored = await eventStore.append(verifiedEvent);
    verifiedEvent.eventId = stored.eventId;
    verifiedEvent.seq = stored.seq;
    // Build JIT claims from the SAML assertion.
    const claims: JitClaims = {
        sub: verified.nameId,
        ...(verified.email !== undefined ? { email: verified.email } : {}),
        ...(verified.givenName !== undefined ? { given_name: verified.givenName } : {}),
        ...(verified.familyName !== undefined ? { family_name: verified.familyName } : {}),
        raw: {
            sub: verified.nameId,
            ...(verified.email !== undefined ? { email: verified.email } : {}),
            // Group claim path on the IdP is whatever the IdP carries —
            // SAML uses a URN; the JIT mapper reads the configured path.
            // Fallback: stash the raw `groups` array under "groups" key
            // so the JIT path can find it via `idp.groupClaimPath ?? 'groups'`.
            groups: verified.groups,
        },
    };
    const jit = await handleJitProvision({
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        claims,
        // The OIDC IDP shape and SAML IDP shape diverge on one field:
        // OIDC's `groupClaimPath` (e.g. 'groups') vs SAML's
        // attribute-name URN. The handler is tolerant — when our
        // synthetic `raw.groups` array is present, the dotted-path
        // walker resolves it as `groups`, applying roleMappings the
        // same way as the JWT path.
        idp: { ...idp, groupClaimPath: 'groups' },
    }, eventStore, entities);
    return {
        envelope: verifiedEvent,
        follow: jit.events,
        user: jit.user,
        membership: jit.membership,
        assertion: verified,
        idp,
    };
}
