import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { OAuthAccessTokenDocument } from '../types.ts';
import { newEventId, newOAuthTokenId } from '../ids.ts';
import { generateSecret, hashSecret, lookupOf } from '../crypto/secret-hash.ts';
import { verifyPassword } from '../crypto/password.ts';
import { getApiKeyEntity } from '../entities/api-key.ts';
import { parseApiKeyBearer } from '../entities/api-key.ts';
export interface OAuthIssueCommand {
    tenantId: string;
    correlationId: string;
    /**
     * RFC 6749 client credentials. We accept BOTH `client_id` +
     * `client_secret` (stripped down: client_id is the keyId, secret is
     * the bearer secret) AND the convenience form where the caller
     * presents the full `atlas_<keyId>_<secret>` bearer string in
     * `clientBearer`.
     */
    clientId?: string;
    clientSecret?: string;
    /** Convenience: full `atlas_<keyId>_<secret>` instead of split form. */
    clientBearer?: string;
    /** Subset of the ApiKey's scopes. Empty = inherit all. */
    requestedScopes?: string[];
    /** Default 1 hour. */
    ttlSeconds?: number;
}
export interface OAuthIssueResult {
    envelope: EventEnvelope;
    document: OAuthAccessTokenDocument;
    /**
     * RFC 6749 token-response body. The `access_token` is the opaque
     * secret part; persisted form is its SHA-256 hash.
     */
    response: {
        access_token: string;
        token_type: 'Bearer';
        expires_in: number;
        scope: string;
    };
}
const DEFAULT_TTL_SECONDS = 60 * 60;
/**
 * `Identity.OAuth.IssueToken` handler — RFC 6749 client_credentials.
 *
 * Validates the presented ApiKey + secret, mints a new opaque access
 * token, persists the hashed entity, and returns the wire-shape
 * response. The token can later be revoked instantly via `/oauth/revoke`.
 */
export async function handleOAuthIssueToken(cmd: OAuthIssueCommand, eventStore: EventStore, entities: EntityStore): Promise<OAuthIssueResult> {
    let keyId: string;
    let secret: string;
    if (cmd.clientBearer) {
        const parsed = parseApiKeyBearer(cmd.clientBearer);
        if (!parsed) {
            throw new IdentityError(codes.OAUTH_INVALID_CLIENT, 'malformed client bearer', 401);
        }
        keyId = parsed.keyId;
        secret = parsed.secret;
    }
    else if (cmd.clientId && cmd.clientSecret) {
        keyId = cmd.clientId;
        secret = cmd.clientSecret;
    }
    else {
        throw new IdentityError(codes.OAUTH_INVALID_CLIENT, 'missing client credentials', 401);
    }
    const apiKey = await getApiKeyEntity(entities, cmd.tenantId, keyId);
    if (!apiKey) {
        throw new IdentityError(codes.OAUTH_INVALID_CLIENT, 'unknown client', 401);
    }
    // Accept active keys + rotated keys still inside the overlap window.
    const now = Date.now();
    if (apiKey.status === 'revoked') {
        throw new IdentityError(codes.OAUTH_INVALID_CLIENT, 'client revoked', 401);
    }
    if (apiKey.status === 'rotated') {
        if (!apiKey.rotationOverlapUntil ||
            new Date(apiKey.rotationOverlapUntil).getTime() <= now) {
            throw new IdentityError(codes.OAUTH_INVALID_CLIENT, 'client rotation overlap window expired', 401);
        }
    }
    if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now) {
        throw new IdentityError(codes.API_KEY_EXPIRED, 'client expired', 401);
    }
    const ok = await verifyPassword(secret, apiKey.secretHash);
    if (!ok) {
        throw new IdentityError(codes.OAUTH_INVALID_CLIENT, 'invalid client secret', 401);
    }
    // Scope filter: requested ⊆ apiKey.scopes; default to apiKey.scopes
    // when caller didn't narrow.
    const requested = cmd.requestedScopes ?? apiKey.scopes;
    const exceeded = requested.filter(function (s) {
        return !apiKey.scopes.includes(s);
    });
    if (exceeded.length > 0) {
        throw new IdentityError(codes.OAUTH_INVALID_SCOPE, `requested scopes exceed key: ${exceeded.join(', ')}`, 400);
    }
    const ttl = cmd.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const occurredAt = new Date().toISOString();
    const tokenSecret = generateSecret();
    const tokenId = newOAuthTokenId();
    const document: OAuthAccessTokenDocument = {
        tokenId,
        tenantId: cmd.tenantId,
        secretHash: hashSecret(tokenSecret),
        secretLookup: lookupOf(tokenSecret),
        apiKeyId: apiKey.keyId,
        servicePrincipalId: apiKey.servicePrincipalId ?? '',
        scopes: [...requested],
        status: 'active',
        issuedAt: occurredAt,
        expiresAt: new Date(now + ttl * 1000).toISOString(),
    };
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Identity.OAuthTokenIssued',
        schemaId: 'domain.identity.oauth.token_issued.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `identity.oauth.issue.${tokenId}`,
        causationId: null,
        principalId: apiKey.keyId,
        userId: apiKey.userId ?? null,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `ApiKey:${apiKey.keyId}`,
            `OAuthToken:${tokenId}`,
        ],
        payload: { document },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    return {
        envelope,
        document,
        response: {
            access_token: tokenSecret,
            token_type: 'Bearer',
            expires_in: ttl,
            scope: requested.join(' '),
        },
    };
}
