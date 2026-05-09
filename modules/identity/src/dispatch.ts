/**
 * Identity event dispatcher.
 *
 * Persists `Identity.*` event payloads to entities + relations.
 * Cache-tag invalidation lives in the wiring layer's
 * `cacheTagDispatcher` — do not call cache here.
 *
 * Storage model:
 *   - User      → entities (`tenantId='_platform'`, type='User')
 *   - Membership→ entities (`tenantId=<tenant>`, type='Membership')
 *                 plus a `membership.user` edge in relations
 *   - InviteToken → entities (`tenantId=<tenant>`, type='InviteToken')
 *                   plus optional `invite.user` edge on accept
 */

import type { EventEnvelope, Logger } from '@atlas/platform-core';
import type {
  Cache,
  EntityStore,
  EventDispatcher,
  RelationStore,
} from '@atlas/ports';
import type {
  ApiKeyDocument,
  AuditExportConfigDocument,
  AuthFactorDocument,
  AuthSessionDocument,
  IdentityProviderDocument,
  InviteTokenDocument,
  MembershipDocument,
  MfaBypassDocument,
  OAuthAccessTokenDocument,
  RecoveryCodeDocument,
  SamlSpKeyDocument,
  ScimTokenDocument,
  ServicePrincipalDocument,
  UserDocument,
} from './types.ts';
import { putUserEntity } from './entities/user.ts';
import { putMembershipEntity } from './entities/membership.ts';
import { putInviteTokenEntity } from './entities/invite-token.ts';
import { putSessionEntity } from './entities/auth-session.ts';
import { putApiKeyEntity } from './entities/api-key.ts';
import { putServicePrincipalEntity } from './entities/service-principal.ts';
import { putOAuthTokenEntity } from './entities/oauth-token.ts';
import { putIdentityProviderEntity } from './entities/identity-provider.ts';
import { putScimTokenEntity } from './entities/scim-token.ts';
import { putAuditExportConfig } from './entities/audit-export-config.ts';
import { putAuthFactorEntity } from './entities/auth-factor.ts';
import { putMfaBypassEntity } from './entities/mfa-bypass.ts';
import { putRecoveryCodeEntity } from './entities/recovery-code.ts';
import { putSamlSpKeyEntity } from './entities/saml-sp-key.ts';
import {
  linkInviteToUser,
  linkMembershipToUser,
} from './entities/relations.ts';

export interface IdentityDispatchContext {
  entities: EntityStore;
  relations: RelationStore;
  cache?: Cache;
  /**
   * Optional logger for per-event debug breadcrumbs. Carried through
   * the wiring layer when available; absent in tests / sim. The
   * dispatcher emits one `Identity.Dispatch.Ran` debug line per
   * dispatched event so operators can trace projection rebuilds.
   */
  logger?: Logger;
}

/**
 * Events that are appended + dispatched but legitimately carry no
 * `payload.document`. These are audit-only or batch-metadata events;
 * the dispatcher returns early without touching projections.
 *
 * Anything NOT in this allowlist that lands here without a document
 * is a bug — handler emit-site dropped the document field. We throw
 * so the failure is visible at dispatch time rather than silently
 * leaving projections stale.
 */
const EVENTS_WITHOUT_DOCUMENT: ReadonlySet<string> = new Set([
  // Audit-only diagnostic event — refresh-token reuse / suspicious
  // refresh patterns. The corresponding RevokeAllForUser flow emits
  // SessionEnded events that DO carry documents.
  'Identity.SessionAnomaly',
  // Batch-metadata events — handlers eager-write the per-code rows,
  // so the dispatcher has nothing extra to persist from the event.
  'Identity.RecoveryCodesGenerated',
  'Identity.RecoveryCodesRegenerated',
]);

// All Phase A2 service-credential events. Each carries a merged
// document on `payload.document`; dispatcher persists.
const A2_KEY_EVENTS: ReadonlySet<string> = new Set([
  'Identity.ApiKeyCreated',
  'Identity.ApiKeyRotated',
  'Identity.ApiKeyRevoked',
  'Identity.ServicePrincipalCreated',
  'Identity.ServicePrincipalScopesChanged',
  'Identity.ServicePrincipalDisabled',
  'Identity.OAuthTokenIssued',
  'Identity.OAuthTokenRevoked',
]);

const HANDLED_EVENT_TYPES = new Set([
  'Identity.UserCreated',
  'Identity.UserUpdated',
  'Identity.AccountLocked',
  'Identity.PasswordChanged',
  'Identity.MembershipCreated',
  'Identity.InviteIssued',
  'Identity.InviteAccepted',
  // Phase A2 — session lifecycle.
  'Identity.SessionIssued',
  'Identity.SessionRefreshed',
  'Identity.SessionEnded',
  // SessionAnomaly is emitted but carries no document — see below.
  'Identity.SessionAnomaly',
  // Phase A3.7 — group-claim → role reconciliation on JWT login.
  'Identity.MembershipRolesChanged',
  // Phase A2.7-A2.9 — service credentials.
  'Identity.ApiKeyCreated',
  'Identity.ApiKeyRotated',
  'Identity.ApiKeyRevoked',
  'Identity.ServicePrincipalCreated',
  'Identity.ServicePrincipalScopesChanged',
  'Identity.ServicePrincipalDisabled',
  'Identity.OAuthTokenIssued',
  'Identity.OAuthTokenRevoked',
  // Phase A3 — federated OIDC.
  'Identity.IdentityProviderConfigured',
  'Identity.IdentityProviderActivated',
  'Identity.IdentityProviderDisabled',
  'Identity.IdentityProviderRotatedJwks',
  // Phase A4 — SCIM tokens.
  'Identity.ScimTokenEnabled',
  'Identity.ScimTokenRotated',
  'Identity.ScimTokenRevoked',
  // Phase A4.8 — audit-export config.
  'Identity.AuditExportConfigured',
  'Identity.AuditExportActivated',
  'Identity.AuditExportDisabled',
  // Phase A5.7 — session MFA promotion event.
  'Identity.SessionMfaSatisfied',
  // Phase A5 — MFA stack.
  'Identity.AuthFactorEnrolled',
  'Identity.AuthFactorRevoked',
  'Identity.MfaChallengeSucceeded',
  'Identity.MfaAnomaly',
  'Identity.MfaLockout',
  'Identity.RecoveryCodesGenerated',
  'Identity.RecoveryCodesRegenerated',
  'Identity.RecoveryCodeConsumed',
  'Identity.MfaBypassIssued',
  'Identity.MfaBypassUsed',
  // Phase A6 — SAML SP key lifecycle.
  'Identity.SamlSpKeyGenerated',
  'Identity.SamlSpKeyRotated',
]);

export async function dispatchIdentityEvent(
  envelope: EventEnvelope,
  ctx: IdentityDispatchContext,
): Promise<void> {
  if (!HANDLED_EVENT_TYPES.has(envelope.eventType)) return;

  // Single debug breadcrumb per dispatched event. Logger is opt-in
  // via the context — sim / unit tests pass nothing and stay silent.
  ctx.logger?.debug('identity dispatcher ran', {
    event: 'Identity.Dispatch.Ran',
    properties: {
      eventType: envelope.eventType,
      eventId: envelope.eventId,
    },
  });

  // Events legitimately without a document (audit-only / batch
  // metadata). Early-return so projections stay untouched.
  if (EVENTS_WITHOUT_DOCUMENT.has(envelope.eventType)) return;

  const payload = envelope.payload as Record<string, unknown>;
  const document = payload['document'] as
    | UserDocument
    | MembershipDocument
    | InviteTokenDocument
    | AuthSessionDocument
    | ApiKeyDocument
    | ServicePrincipalDocument
    | OAuthAccessTokenDocument
    | IdentityProviderDocument
    | ScimTokenDocument
    | AuditExportConfigDocument
    | AuthFactorDocument
    | RecoveryCodeDocument
    | MfaBypassDocument
    | SamlSpKeyDocument
    | undefined;
  if (!document) {
    // Hard failure: event type is in HANDLED_EVENT_TYPES, not in the
    // EVENTS_WITHOUT_DOCUMENT allowlist, but the emit-site forgot to
    // attach `payload.document`. Silently dropping leaves projections
    // stale — surface it instead so the bug shows up immediately
    // rather than as inexplicably-missing read-model rows.
    throw new Error(
      `dispatchIdentityEvent: ${envelope.eventType} (eventId=${envelope.eventId ?? 'unset'}) has no payload.document and is not in EVENTS_WITHOUT_DOCUMENT — handler emit-site bug`,
    );
  }

  if (
    envelope.eventType === 'Identity.UserCreated' ||
    envelope.eventType === 'Identity.UserUpdated' ||
    envelope.eventType === 'Identity.AccountLocked' ||
    envelope.eventType === 'Identity.PasswordChanged'
  ) {
    // All four event types carry the same merged-User payload shape.
    // The event-type discrimination lives at the *audit* layer (event
    // log carries the semantic event); the dispatcher just persists.
    await putUserEntity(ctx.entities, document as UserDocument, envelope.tenantId);
  } else if (envelope.eventType === 'Identity.MembershipCreated') {
    const m = document as MembershipDocument;
    await putMembershipEntity(ctx.entities, m);
    await linkMembershipToUser(ctx.relations, m.tenantId, m.userId);
  } else if (envelope.eventType === 'Identity.MembershipRolesChanged') {
    // A3.7: roles reconciled from JWT group claim. Just upsert the
    // merged document; the relation is unchanged.
    await putMembershipEntity(ctx.entities, document as MembershipDocument);
  } else if (envelope.eventType === 'Identity.InviteIssued') {
    await putInviteTokenEntity(ctx.entities, document as InviteTokenDocument);
  } else if (envelope.eventType === 'Identity.InviteAccepted') {
    const t = document as InviteTokenDocument;
    await putInviteTokenEntity(ctx.entities, t);
    if (t.acceptedUserId) {
      await linkInviteToUser(
        ctx.relations,
        t.tenantId,
        t.tokenId,
        t.acceptedUserId,
      );
    }
  } else if (
    envelope.eventType === 'Identity.SessionIssued' ||
    envelope.eventType === 'Identity.SessionRefreshed' ||
    envelope.eventType === 'Identity.SessionEnded' ||
    envelope.eventType === 'Identity.SessionMfaSatisfied'
  ) {
    // All four carry the merged AuthSession document; the dispatcher
    // just persists. Status discrimination lives at the audit layer.
    await putSessionEntity(ctx.entities, document as AuthSessionDocument);
  } else if (A2_KEY_EVENTS.has(envelope.eventType)) {
    if (
      envelope.eventType.startsWith('Identity.ApiKey')
    ) {
      await putApiKeyEntity(ctx.entities, document as ApiKeyDocument);
    } else if (envelope.eventType.startsWith('Identity.ServicePrincipal')) {
      await putServicePrincipalEntity(
        ctx.entities,
        document as ServicePrincipalDocument,
      );
    } else if (envelope.eventType.startsWith('Identity.OAuth')) {
      await putOAuthTokenEntity(
        ctx.entities,
        document as OAuthAccessTokenDocument,
      );
    }
  } else if (envelope.eventType.startsWith('Identity.ScimToken')) {
    // ScimToken Enabled / Rotated / Revoked all carry the merged
    // ScimToken document.
    await putScimTokenEntity(ctx.entities, document as ScimTokenDocument);
  } else if (envelope.eventType.startsWith('Identity.IdentityProvider')) {
    // All four IDP events (Configured / Activated / Disabled /
    // RotatedJwks) carry a merged IdentityProviderDocument. Persist.
    await putIdentityProviderEntity(
      ctx.entities,
      document as IdentityProviderDocument,
    );
  } else if (envelope.eventType.startsWith('Identity.AuditExport')) {
    // AuditExport Configured / Activated / Disabled. Run-level
    // events come from the worker (A4.9) and bypass this dispatcher.
    await putAuditExportConfig(
      ctx.entities,
      document as AuditExportConfigDocument,
    );
  } else if (
    envelope.eventType === 'Identity.AuthFactorEnrolled' ||
    envelope.eventType === 'Identity.AuthFactorRevoked' ||
    envelope.eventType === 'Identity.MfaChallengeSucceeded' ||
    envelope.eventType === 'Identity.MfaAnomaly' ||
    envelope.eventType === 'Identity.MfaLockout'
  ) {
    // All five factor-touching events carry the merged AuthFactor
    // document. RecoveryCode + MfaBypass are separate entities; their
    // dispatcher branches land below.
    await putAuthFactorEntity(ctx.entities, document as AuthFactorDocument);
  } else if (envelope.eventType === 'Identity.RecoveryCodeConsumed') {
    // Per-code event with a single document. RecoveryCodesGenerated /
    // Regenerated emit batch metadata (no `document`) — the handler
    // eager-writes the per-code rows since we can't reconstruct them
    // from the batch event alone.
    await putRecoveryCodeEntity(
      ctx.entities,
      document as RecoveryCodeDocument,
    );
  } else if (
    envelope.eventType === 'Identity.MfaBypassIssued' ||
    envelope.eventType === 'Identity.MfaBypassUsed'
  ) {
    await putMfaBypassEntity(ctx.entities, document as MfaBypassDocument);
  } else if (
    envelope.eventType === 'Identity.SamlSpKeyGenerated' ||
    envelope.eventType === 'Identity.SamlSpKeyRotated'
  ) {
    await putSamlSpKeyEntity(ctx.entities, document as SamlSpKeyDocument);
  }
}

/**
 * Factory: bind an `IdentityDispatchContext` and return an
 * `EventDispatcher`. Designed for `composeDispatchers`.
 */
export function identityDispatcher(
  ctx: IdentityDispatchContext,
): EventDispatcher {
  return (envelope) => dispatchIdentityEvent(envelope, ctx);
}
