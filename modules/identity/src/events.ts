/**
 * Typed event envelope union for every `Identity.*` event the
 * dispatcher persists.
 *
 * The union is discriminated on `eventType` (a string literal on each
 * variant), and each variant pins the `payload` shape — typically
 * `{ document: XDocument }` — so the dispatcher's `switch` arms get
 * field-level narrowing automatically. No
 * `envelope.payload as Record<string, unknown>` + `document as XDocument`
 * cast ladder, and no runtime "no document — emit-site bug" throw
 * needed: events that legitimately carry no document declare a payload
 * shape that simply doesn't have a `document` field, and TS prevents
 * the case arm from reaching for it.
 *
 * **Membership.** The union mirrors `HANDLED_EVENT_TYPES` in
 * `dispatch.ts` (the only events the identity dispatcher persists).
 * When you add a new dispatched event type:
 *   1. Add the variant here.
 *   2. Add the event-type literal to `HANDLED_EVENT_TYPES`.
 *   3. Handle the new case in the `switch` in `dispatchIdentityEvent`;
 *      the `_exhaustive: never` arm will compile-error until you do.
 */

import type { EventEnvelope } from '@atlas/platform-core';
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

// --------------------------------------------------------------------
// Phase A1 — users, memberships, invites.
// --------------------------------------------------------------------

export type IdentityUserCreatedEvent = EventEnvelope<
  'Identity.UserCreated',
  { document: UserDocument }
>;
export type IdentityUserUpdatedEvent = EventEnvelope<
  'Identity.UserUpdated',
  { document: UserDocument }
>;
export type IdentityAccountLockedEvent = EventEnvelope<
  'Identity.AccountLocked',
  { document: UserDocument }
>;
export type IdentityPasswordChangedEvent = EventEnvelope<
  'Identity.PasswordChanged',
  { document: UserDocument }
>;
export type IdentityMembershipCreatedEvent = EventEnvelope<
  'Identity.MembershipCreated',
  { document: MembershipDocument }
>;
export type IdentityMembershipRolesChangedEvent = EventEnvelope<
  'Identity.MembershipRolesChanged',
  { document: MembershipDocument }
>;
export type IdentityInviteIssuedEvent = EventEnvelope<
  'Identity.InviteIssued',
  { document: InviteTokenDocument }
>;
export type IdentityInviteAcceptedEvent = EventEnvelope<
  'Identity.InviteAccepted',
  { document: InviteTokenDocument; userId?: string }
>;

// --------------------------------------------------------------------
// Phase A2 — session lifecycle.
// --------------------------------------------------------------------

export type IdentitySessionIssuedEvent = EventEnvelope<
  'Identity.SessionIssued',
  { document: AuthSessionDocument }
>;
export type IdentitySessionRefreshedEvent = EventEnvelope<
  'Identity.SessionRefreshed',
  { document: AuthSessionDocument }
>;
export type IdentitySessionEndedEvent = EventEnvelope<
  'Identity.SessionEnded',
  { document: AuthSessionDocument; reason?: string }
>;
export type IdentitySessionMfaSatisfiedEvent = EventEnvelope<
  'Identity.SessionMfaSatisfied',
  { document: AuthSessionDocument }
>;
/**
 * Audit-only event. Carries no `document` — the dispatcher early-returns
 * without persisting. Other diagnostic metadata may live on the payload,
 * intentionally typed as `Record<string, unknown>` so the dispatcher
 * doesn't reach for non-existent fields.
 */
export type IdentitySessionAnomalyEvent = EventEnvelope<
  'Identity.SessionAnomaly',
  Record<string, unknown>
>;

// --------------------------------------------------------------------
// Phase A2.7-A2.9 — service credentials.
// --------------------------------------------------------------------

export type IdentityApiKeyCreatedEvent = EventEnvelope<
  'Identity.ApiKeyCreated',
  { document: ApiKeyDocument }
>;
export type IdentityApiKeyRotatedEvent = EventEnvelope<
  'Identity.ApiKeyRotated',
  { document: ApiKeyDocument }
>;
export type IdentityApiKeyRevokedEvent = EventEnvelope<
  'Identity.ApiKeyRevoked',
  { document: ApiKeyDocument }
>;
export type IdentityServicePrincipalCreatedEvent = EventEnvelope<
  'Identity.ServicePrincipalCreated',
  { document: ServicePrincipalDocument }
>;
export type IdentityServicePrincipalScopesChangedEvent = EventEnvelope<
  'Identity.ServicePrincipalScopesChanged',
  { document: ServicePrincipalDocument }
>;
export type IdentityServicePrincipalDisabledEvent = EventEnvelope<
  'Identity.ServicePrincipalDisabled',
  { document: ServicePrincipalDocument }
>;
export type IdentityOAuthTokenIssuedEvent = EventEnvelope<
  'Identity.OAuthTokenIssued',
  { document: OAuthAccessTokenDocument }
>;
export type IdentityOAuthTokenRevokedEvent = EventEnvelope<
  'Identity.OAuthTokenRevoked',
  { document: OAuthAccessTokenDocument }
>;

// --------------------------------------------------------------------
// Phase A3 — federated OIDC.
// --------------------------------------------------------------------

export type IdentityProviderConfiguredEvent = EventEnvelope<
  'Identity.IdentityProviderConfigured',
  { document: IdentityProviderDocument }
>;
export type IdentityProviderActivatedEvent = EventEnvelope<
  'Identity.IdentityProviderActivated',
  { document: IdentityProviderDocument }
>;
export type IdentityProviderDisabledEvent = EventEnvelope<
  'Identity.IdentityProviderDisabled',
  { document: IdentityProviderDocument }
>;
export type IdentityProviderRotatedJwksEvent = EventEnvelope<
  'Identity.IdentityProviderRotatedJwks',
  { document: IdentityProviderDocument }
>;

// --------------------------------------------------------------------
// Phase A4 — SCIM + audit export.
// --------------------------------------------------------------------

export type IdentityScimTokenEnabledEvent = EventEnvelope<
  'Identity.ScimTokenEnabled',
  { document: ScimTokenDocument }
>;
export type IdentityScimTokenRotatedEvent = EventEnvelope<
  'Identity.ScimTokenRotated',
  { document: ScimTokenDocument }
>;
export type IdentityScimTokenRevokedEvent = EventEnvelope<
  'Identity.ScimTokenRevoked',
  { document: ScimTokenDocument }
>;
export type IdentityAuditExportConfiguredEvent = EventEnvelope<
  'Identity.AuditExportConfigured',
  { document: AuditExportConfigDocument }
>;
export type IdentityAuditExportActivatedEvent = EventEnvelope<
  'Identity.AuditExportActivated',
  { document: AuditExportConfigDocument }
>;
export type IdentityAuditExportDisabledEvent = EventEnvelope<
  'Identity.AuditExportDisabled',
  { document: AuditExportConfigDocument }
>;

// --------------------------------------------------------------------
// Phase A5 — MFA stack.
// --------------------------------------------------------------------

export type IdentityAuthFactorEnrolledEvent = EventEnvelope<
  'Identity.AuthFactorEnrolled',
  { document: AuthFactorDocument }
>;
export type IdentityAuthFactorRevokedEvent = EventEnvelope<
  'Identity.AuthFactorRevoked',
  { document: AuthFactorDocument }
>;
export type IdentityMfaChallengeSucceededEvent = EventEnvelope<
  'Identity.MfaChallengeSucceeded',
  { document: AuthFactorDocument }
>;
export type IdentityMfaAnomalyEvent = EventEnvelope<
  'Identity.MfaAnomaly',
  { document: AuthFactorDocument }
>;
export type IdentityMfaLockoutEvent = EventEnvelope<
  'Identity.MfaLockout',
  { document: AuthFactorDocument }
>;
/**
 * Recovery-code batch events: the handler eager-writes the per-code
 * rows since they can't be reconstructed from the batch event alone,
 * so the dispatcher has no document to persist. Allow-listed payload.
 */
export type IdentityRecoveryCodesGeneratedEvent = EventEnvelope<
  'Identity.RecoveryCodesGenerated',
  Record<string, unknown>
>;
export type IdentityRecoveryCodesRegeneratedEvent = EventEnvelope<
  'Identity.RecoveryCodesRegenerated',
  Record<string, unknown>
>;
export type IdentityRecoveryCodeConsumedEvent = EventEnvelope<
  'Identity.RecoveryCodeConsumed',
  { document: RecoveryCodeDocument }
>;
export type IdentityMfaBypassIssuedEvent = EventEnvelope<
  'Identity.MfaBypassIssued',
  { document: MfaBypassDocument }
>;
export type IdentityMfaBypassUsedEvent = EventEnvelope<
  'Identity.MfaBypassUsed',
  { document: MfaBypassDocument }
>;

// --------------------------------------------------------------------
// Phase A6 — SAML SP key lifecycle.
// --------------------------------------------------------------------

export type IdentitySamlSpKeyGeneratedEvent = EventEnvelope<
  'Identity.SamlSpKeyGenerated',
  { document: SamlSpKeyDocument }
>;
export type IdentitySamlSpKeyRotatedEvent = EventEnvelope<
  'Identity.SamlSpKeyRotated',
  { document: SamlSpKeyDocument }
>;

/**
 * Discriminated union of every identity event the dispatcher knows how
 * to persist. The discriminator is `eventType`.
 *
 * Identity emits more events than are listed here (e.g.
 * `Identity.LoginRejected`, `Identity.LoginSucceeded`) but those are
 * audit-only — the dispatcher returns early without persisting. They
 * are intentionally not part of this union; the dispatcher's
 * `HANDLED_EVENT_TYPES` predicate filters them out before narrowing.
 */
export type IdentityEventEnvelope =
  | IdentityUserCreatedEvent
  | IdentityUserUpdatedEvent
  | IdentityAccountLockedEvent
  | IdentityPasswordChangedEvent
  | IdentityMembershipCreatedEvent
  | IdentityMembershipRolesChangedEvent
  | IdentityInviteIssuedEvent
  | IdentityInviteAcceptedEvent
  | IdentitySessionIssuedEvent
  | IdentitySessionRefreshedEvent
  | IdentitySessionEndedEvent
  | IdentitySessionMfaSatisfiedEvent
  | IdentitySessionAnomalyEvent
  | IdentityApiKeyCreatedEvent
  | IdentityApiKeyRotatedEvent
  | IdentityApiKeyRevokedEvent
  | IdentityServicePrincipalCreatedEvent
  | IdentityServicePrincipalScopesChangedEvent
  | IdentityServicePrincipalDisabledEvent
  | IdentityOAuthTokenIssuedEvent
  | IdentityOAuthTokenRevokedEvent
  | IdentityProviderConfiguredEvent
  | IdentityProviderActivatedEvent
  | IdentityProviderDisabledEvent
  | IdentityProviderRotatedJwksEvent
  | IdentityScimTokenEnabledEvent
  | IdentityScimTokenRotatedEvent
  | IdentityScimTokenRevokedEvent
  | IdentityAuditExportConfiguredEvent
  | IdentityAuditExportActivatedEvent
  | IdentityAuditExportDisabledEvent
  | IdentityAuthFactorEnrolledEvent
  | IdentityAuthFactorRevokedEvent
  | IdentityMfaChallengeSucceededEvent
  | IdentityMfaAnomalyEvent
  | IdentityMfaLockoutEvent
  | IdentityRecoveryCodesGeneratedEvent
  | IdentityRecoveryCodesRegeneratedEvent
  | IdentityRecoveryCodeConsumedEvent
  | IdentityMfaBypassIssuedEvent
  | IdentityMfaBypassUsedEvent
  | IdentitySamlSpKeyGeneratedEvent
  | IdentitySamlSpKeyRotatedEvent;

/**
 * Type guard for the identity dispatcher's typed-narrowing path.
 *
 * Returns true iff the envelope's `eventType` is one of the literal
 * strings the dispatcher knows how to handle. Used by
 * `dispatchIdentityEvent` to flip an opaque `EventEnvelope` into the
 * typed `IdentityEventEnvelope` union without an `as` cast.
 *
 * The set MUST stay in sync with `HANDLED_EVENT_TYPES` in
 * `dispatch.ts` (which is built from the same string-literal set).
 */
const IDENTITY_EVENT_TYPES = new Set<IdentityEventEnvelope['eventType']>([
  'Identity.UserCreated',
  'Identity.UserUpdated',
  'Identity.AccountLocked',
  'Identity.PasswordChanged',
  'Identity.MembershipCreated',
  'Identity.MembershipRolesChanged',
  'Identity.InviteIssued',
  'Identity.InviteAccepted',
  'Identity.SessionIssued',
  'Identity.SessionRefreshed',
  'Identity.SessionEnded',
  'Identity.SessionMfaSatisfied',
  'Identity.SessionAnomaly',
  'Identity.ApiKeyCreated',
  'Identity.ApiKeyRotated',
  'Identity.ApiKeyRevoked',
  'Identity.ServicePrincipalCreated',
  'Identity.ServicePrincipalScopesChanged',
  'Identity.ServicePrincipalDisabled',
  'Identity.OAuthTokenIssued',
  'Identity.OAuthTokenRevoked',
  'Identity.IdentityProviderConfigured',
  'Identity.IdentityProviderActivated',
  'Identity.IdentityProviderDisabled',
  'Identity.IdentityProviderRotatedJwks',
  'Identity.ScimTokenEnabled',
  'Identity.ScimTokenRotated',
  'Identity.ScimTokenRevoked',
  'Identity.AuditExportConfigured',
  'Identity.AuditExportActivated',
  'Identity.AuditExportDisabled',
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
  'Identity.SamlSpKeyGenerated',
  'Identity.SamlSpKeyRotated',
]);

export function isIdentityEvent(
  env: EventEnvelope,
): env is IdentityEventEnvelope {
  // `Set<T>.has` takes `T` strictly — widen the call signature to `string`
  // so the type-guard call doesn't need a narrowing cast on the input.
  const types: ReadonlySet<string> = IDENTITY_EVENT_TYPES;
  return types.has(env.eventType);
}

export { IDENTITY_EVENT_TYPES };
