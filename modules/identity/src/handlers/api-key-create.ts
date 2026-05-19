import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { ApiKeyDocument } from '../types.ts';
import { newApiKeyId, newEventId } from '../ids.ts';
import { generateSecret } from '../crypto/secret-hash.ts';
import { hashPassword } from '../crypto/password.ts';
import { getServicePrincipalEntity } from '../entities/service-principal.ts';
export interface ApiKeyCreateCommand {
    tenantId: string;
    correlationId: string;
    /** Caller (admin/user) creating the key, recorded on the audit event. */
    principalId: string | null;
    name: string;
    /** Exactly one of userId / servicePrincipalId must be set. */
    userId?: string;
    servicePrincipalId?: string;
    scopes: string[];
    expiresAt?: string;
}
export interface ApiKeyCreateResult {
    envelope: EventEnvelope;
    document: ApiKeyDocument;
    /**
     * Plaintext bearer string `atlas_<keyId>_<secret>`. Surfaced ONCE to
     * the caller — the route layer returns it in the response body.
     * Never persisted.
     */
    plaintextBearer: string;
}
/**
 * `Identity.ApiKey.Create` handler.
 *
 * Mints a new ApiKey. Validates owner (exactly one of userId /
 * servicePrincipalId) and, when owned by a SP, that the requested
 * scopes ⊆ sp.scopes (the scope ceiling).
 */
export async function handleApiKeyCreate(cmd: ApiKeyCreateCommand, eventStore: EventStore, entities: EntityStore): Promise<ApiKeyCreateResult> {
    const hasUser = typeof cmd.userId === 'string' && cmd.userId.length > 0;
    const hasSp = typeof cmd.servicePrincipalId === 'string' && cmd.servicePrincipalId.length > 0;
    if (hasUser === hasSp) {
        throw new IdentityError(codes.IDENTITY_INVALID, 'ApiKey requires exactly one of userId or servicePrincipalId', 400);
    }
    // Scope-ceiling enforcement for SP-owned keys.
    if (hasSp && cmd.servicePrincipalId !== undefined) {
        const sp = await getServicePrincipalEntity(entities, cmd.tenantId, cmd.servicePrincipalId);
        if (!sp) {
            throw new IdentityError(codes.SERVICE_PRINCIPAL_NOT_FOUND, `service principal not found: ${cmd.servicePrincipalId}`, 404);
        }
        if (sp.status !== 'active') {
            throw new IdentityError(codes.SERVICE_PRINCIPAL_DISABLED, `service principal ${cmd.servicePrincipalId} is disabled`, 409);
        }
        const exceeded = cmd.scopes.filter(function (s) {
            return !sp.scopes.includes(s);
        });
        if (exceeded.length > 0) {
            throw new IdentityError(codes.SERVICE_PRINCIPAL_SCOPE_EXCEEDED, `requested scopes exceed SP ceiling: ${exceeded.join(', ')}`, 403);
        }
    }
    const occurredAt = new Date().toISOString();
    const keyId = newApiKeyId();
    const secret = generateSecret();
    const secretHash = await hashPassword(secret);
    const document: ApiKeyDocument = {
        keyId,
        tenantId: cmd.tenantId,
        secretHash,
        name: cmd.name,
        scopes: [...cmd.scopes],
        status: 'active',
        issuedAt: occurredAt,
        ...(hasUser ? { userId: cmd.userId } : {}),
        ...(hasSp ? { servicePrincipalId: cmd.servicePrincipalId } : {}),
        ...(cmd.expiresAt !== undefined ? { expiresAt: cmd.expiresAt } : {}),
    };
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Identity.ApiKeyCreated',
        schemaId: 'domain.identity.api_key.created.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `identity.api-key.create.${keyId}`,
        causationId: null,
        principalId: cmd.principalId,
        userId: cmd.principalId,
        cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ApiKey:${keyId}`],
        payload: { document },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    return {
        envelope,
        document,
        plaintextBearer: `atlas_${keyId}.${secret}`,
    };
}
