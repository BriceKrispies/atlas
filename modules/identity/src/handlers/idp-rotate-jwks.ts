import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  IdentityProviderDocument,
  OidcDiscoveryDocument,
} from '../types.ts';
import { newEventId } from '../ids.ts';
import { getIdentityProviderEntity } from '../entities/identity-provider.ts';

export interface IdpRotateJwksCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  idpId: string;
  /**
   * Optional refreshed discovery document (when the IDP's
   * `jwks_uri` itself changed). Most rotations don't change the
   * URI — the same endpoint just serves new keys; for those, this
   * is omitted and the cache layer refetches on next lookup.
   */
  discoveryDocument?: OidcDiscoveryDocument;
  /** Optional override of the JWKS URI. */
  jwksUri?: string;
}

export interface IdpRotateJwksResult {
  envelope: EventEnvelope;
  document: IdentityProviderDocument;
}

/**
 * `Identity.IdentityProvider.RotateJwks` handler.
 *
 * Stamps `jwksFetchedAt` to invalidate the per-process JWKS cache —
 * next JWT verification refetches the JWKS. Optionally updates the
 * discovery document and `jwksUri` when the IDP's endpoints
 * themselves moved (rare; e.g., domain rename).
 *
 * Existing AuthSessions are unaffected (opaque tokens).
 */
export async function handleIdpRotateJwks(
  cmd: IdpRotateJwksCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<IdpRotateJwksResult> {
  const existing = await getIdentityProviderEntity(
    entities,
    cmd.tenantId,
    cmd.idpId,
  );
  if (!existing) {
    throw new IdentityError(
      codes.IDP_NOT_FOUND,
      `identity provider not found: ${cmd.idpId}`,
      404,
    );
  }
  const occurredAt = new Date().toISOString();
  // Reset jwksFetchedAt so the cache layer treats the JWKS as stale.
  // Spreading `existing` first lets us drop the field by omission rather
  // than writing an `undefined` sentinel into the JSON column.
  const { jwksFetchedAt: _droppedJwksFetchedAt, ...withoutFetchedAt } = existing;
  void _droppedJwksFetchedAt;
  const document: IdentityProviderDocument = {
    ...withoutFetchedAt,
    ...(cmd.discoveryDocument !== undefined
      ? { discoveryDocument: cmd.discoveryDocument }
      : {}),
    ...(cmd.jwksUri !== undefined ? { jwksUri: cmd.jwksUri } : {}),
    updatedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.IdentityProviderRotatedJwks',
    schemaId: 'domain.identity.idp.rotated_jwks.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.idp.rotate-jwks.${cmd.idpId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `IdentityProvider:${cmd.idpId}`,
      `Jwks:${cmd.idpId}`,
    ],
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}
