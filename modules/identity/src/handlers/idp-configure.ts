import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  IdentityProviderDocument,
  IdentityProviderKind,
  OidcDiscoveryDocument,
  RoleMapping,
} from '../types.ts';
import { newEventId, newIdentityProviderId } from '../ids.ts';

export interface IdpConfigureCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  /** Default 'oidc'. Phase A3 ships only OIDC; Phase A6 adds SAML. */
  kind?: IdentityProviderKind;
  displayName: string;
  /** JWT `iss` claim — the lookup key. */
  issuer: string;
  audience: string;
  /**
   * Direct JWKS endpoint URL. When provided, discovery is skipped.
   * When absent, `discoveryDocument` is required (caller already
   * resolved discovery out-of-band) — Phase A3 doesn't fetch
   * discovery at handle-time to keep the handler I/O-free.
   */
  jwksUri?: string;
  discoveryDocument?: OidcDiscoveryDocument;
  /** Default false — most enterprises require pre-provisioned invites. */
  requireInvite?: boolean;
  defaultRolesOnFirstLogin?: string[];
  groupClaimPath?: string;
  roleMappings?: RoleMapping[];
  priority?: number;
}

export interface IdpConfigureResult {
  envelope: EventEnvelope;
  document: IdentityProviderDocument;
}

/**
 * `Identity.IdentityProvider.Configure` handler.
 *
 * Creates a new IdentityProvider in `'configured'` status (NOT
 * `'active'` — admin must explicitly Activate to start accepting
 * JWTs from the IDP). Validates that at least one of `jwksUri` or
 * `discoveryDocument.jwks_uri` is present; rejects otherwise.
 *
 * The handler is I/O-free — discovery URL fetching happens in the
 * route layer (or the admin tool) and the resolved document is
 * passed in. This keeps the handler deterministic and testable.
 */
export async function handleIdpConfigure(
  cmd: IdpConfigureCommand,
  eventStore: EventStore,
): Promise<IdpConfigureResult> {
  const jwksUri = cmd.jwksUri ?? cmd.discoveryDocument?.jwks_uri;
  if (!jwksUri) {
    throw new IdentityError(
      codes.IDP_INVALID_CONFIG,
      'either jwksUri or discoveryDocument.jwks_uri is required',
      400,
    );
  }
  if (!cmd.issuer || !cmd.audience) {
    throw new IdentityError(
      codes.IDP_INVALID_CONFIG,
      'issuer and audience are required',
      400,
    );
  }
  const occurredAt = new Date().toISOString();
  const idpId = newIdentityProviderId();
  const document: IdentityProviderDocument = {
    idpId,
    tenantId: cmd.tenantId,
    kind: cmd.kind ?? 'oidc',
    displayName: cmd.displayName,
    issuer: cmd.issuer,
    audience: cmd.audience,
    jwksUri,
    requireInvite: cmd.requireInvite ?? false,
    defaultRolesOnFirstLogin: [...(cmd.defaultRolesOnFirstLogin ?? [])],
    roleMappings: [...(cmd.roleMappings ?? [])],
    priority: cmd.priority ?? 100,
    status: 'configured',
    createdAt: occurredAt,
    updatedAt: occurredAt,
    ...(cmd.discoveryDocument !== undefined
      ? { discoveryDocument: cmd.discoveryDocument }
      : {}),
    ...(cmd.groupClaimPath !== undefined
      ? { groupClaimPath: cmd.groupClaimPath }
      : {}),
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.IdentityProviderConfigured',
    schemaId: 'domain.identity.idp.configured.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.idp.configure.${idpId}`,
    causationId: null,
    principalId: cmd.principalId,
    // Tenant-scoped IdP config event — no User subject. The actor is in
    // `principalId`.
    userId: null,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `IdentityProvider:${idpId}`,
    ],
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}
