import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { OAuthAccessTokenDocument } from '../types.ts';
import { newEventId } from '../ids.ts';
import { hashSecret, lookupOf, constantTimeEqual } from '../crypto/secret-hash.ts';
import { findOAuthTokensByLookup } from '../entities/oauth-token.ts';
export interface OAuthRevokeCommand {
    tenantId: string;
    correlationId: string;
    principalId: string | null;
    /** Plaintext access token to revoke. */
    presentedToken: string;
    reason?: 'client_revoke' | 'admin_revoke';
}
export interface OAuthRevokeResult {
    envelope: EventEnvelope | null;
    document: OAuthAccessTokenDocument | null;
}
/**
 * `Identity.OAuth.RevokeToken` — RFC 7009.
 *
 * Per spec, the response is 200 even if the token is unknown
 * (prevents enumeration). Internally: we look up by hash; if found
 * we flip to revoked and emit an audit event.
 */
export async function handleOAuthRevokeToken(cmd: OAuthRevokeCommand, eventStore: EventStore, entities: EntityStore): Promise<OAuthRevokeResult> {
    const candidates = await findOAuthTokensByLookup(entities, cmd.tenantId, lookupOf(cmd.presentedToken));
    const presentedHash = hashSecret(cmd.presentedToken);
    const token = candidates.find(function (t) {
        return constantTimeEqual(t.secretHash, presentedHash);
    });
    if (!token) {
        // RFC 7009 §2.2: respond 200 even when token is unknown. Caller
        // returns 200; this handler returns null so the route emits no
        // audit event.
        return { envelope: null, document: null };
    }
    if (token.status !== 'active') {
        // Already revoked → idempotent success, no fresh audit emit.
        return { envelope: null, document: token };
    }
    const occurredAt = new Date().toISOString();
    const revoked: OAuthAccessTokenDocument = {
        ...token,
        status: 'revoked',
        revokedAt: occurredAt,
        revokedReason: cmd.reason ?? 'client_revoke',
    };
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Identity.OAuthTokenRevoked',
        schemaId: 'domain.identity.oauth.token_revoked.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `identity.oauth.revoke.${token.tokenId}.${occurredAt}`,
        causationId: null,
        principalId: cmd.principalId,
        // OAuth access tokens are owned by ServicePrincipals, not Users —
        // there is no User subject for this event. `principalId` is the
        // actor (robot on RFC 7009 public revoke; the operator on
        // admin-revoke). NOTE: if a future capability binds OAuth tokens
        // to a User, revisit this — for now `null` is the correct subject.
        userId: null,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `OAuthToken:${token.tokenId}`,
        ],
        payload: { document: revoked },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    // Belt-and-braces: throw if the token can't be a valid principal —
    // unreachable today since the lookup just succeeded.
    if (!revoked.tokenId) {
        throw new IdentityError(codes.IDENTITY_INVALID, 'unreachable: revoked token missing id', 500);
    }
    return { envelope, document: revoked };
}
