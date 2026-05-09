/**
 * Map an emitted `Identity.*` event type to its log shape (level + event
 * name) for the registry-shim wrapper in `registry.ts`.
 *
 * Single, auditable table. Adding a new event type that the wrapper
 * should classify means adding one row here — never touching the
 * wrapper or handler bodies.
 *
 * Default fallback (event type not in the table) emits at `info` with
 * `event: 'Identity.<verb>.Emitted'`. The verb is the segment after
 * the leading `Identity.` prefix. This keeps new events from going
 * silent if the table drifts behind handler additions, while still
 * highlighting them as un-classified in log dashboards.
 */
export type LogShapeLevel = 'info' | 'warn' | 'error';

export interface LogShape {
  level: LogShapeLevel;
  /**
   * Domain.Verb.Outcome string per `specs/crosscut/logging.md`.
   * Outcome = Success | Rejected | Failed | Emitted.
   */
  event: string;
}

const TABLE: ReadonlyMap<string, LogShape> = new Map<string, LogShape>([
  // ----- User / Membership / Invite ----------------------------------
  ['Identity.UserCreated', { level: 'info', event: 'Identity.User.Success' }],
  ['Identity.UserUpdated', { level: 'info', event: 'Identity.User.Success' }],
  ['Identity.MembershipCreated', { level: 'info', event: 'Identity.Membership.Success' }],
  ['Identity.MembershipRolesChanged', { level: 'info', event: 'Identity.Membership.Success' }],
  ['Identity.InviteIssued', { level: 'info', event: 'Identity.Invite.Success' }],
  ['Identity.InviteAccepted', { level: 'info', event: 'Identity.Invite.Success' }],

  // ----- Login / Account lockout -------------------------------------
  ['Identity.LoginSucceeded', { level: 'info', event: 'Identity.Login.Success' }],
  ['Identity.LoginRejected', { level: 'warn', event: 'Identity.Login.Rejected' }],
  ['Identity.AccountLocked', { level: 'warn', event: 'Identity.Login.Rejected' }],
  ['Identity.PasswordChanged', { level: 'info', event: 'Identity.Password.Success' }],

  // ----- Session lifecycle -------------------------------------------
  ['Identity.SessionIssued', { level: 'info', event: 'Identity.Session.Success' }],
  ['Identity.SessionRefreshed', { level: 'info', event: 'Identity.Session.Success' }],
  ['Identity.SessionEnded', { level: 'info', event: 'Identity.Session.Success' }],
  ['Identity.SessionMfaSatisfied', { level: 'info', event: 'Identity.Session.Success' }],
  ['Identity.SessionAnomaly', { level: 'warn', event: 'Identity.Session.Rejected' }],

  // ----- API key / service principal / OAuth -------------------------
  ['Identity.ApiKeyCreated', { level: 'info', event: 'Identity.ApiKey.Success' }],
  ['Identity.ApiKeyRotated', { level: 'info', event: 'Identity.ApiKey.Success' }],
  ['Identity.ApiKeyRevoked', { level: 'info', event: 'Identity.ApiKey.Success' }],
  ['Identity.ServicePrincipalCreated', { level: 'info', event: 'Identity.ServicePrincipal.Success' }],
  ['Identity.ServicePrincipalScopesChanged', { level: 'info', event: 'Identity.ServicePrincipal.Success' }],
  ['Identity.ServicePrincipalDisabled', { level: 'info', event: 'Identity.ServicePrincipal.Success' }],
  ['Identity.OAuthTokenIssued', { level: 'info', event: 'Identity.OAuth.Success' }],
  ['Identity.OAuthTokenRevoked', { level: 'info', event: 'Identity.OAuth.Success' }],

  // ----- Federated OIDC ----------------------------------------------
  ['Identity.IdentityProviderConfigured', { level: 'info', event: 'Identity.Idp.Success' }],
  ['Identity.IdentityProviderActivated', { level: 'info', event: 'Identity.Idp.Success' }],
  ['Identity.IdentityProviderDisabled', { level: 'info', event: 'Identity.Idp.Success' }],
  ['Identity.IdentityProviderRotatedJwks', { level: 'info', event: 'Identity.Idp.Success' }],

  // ----- SCIM tokens / audit-export config ---------------------------
  ['Identity.ScimTokenEnabled', { level: 'info', event: 'Identity.ScimToken.Success' }],
  ['Identity.ScimTokenRotated', { level: 'info', event: 'Identity.ScimToken.Success' }],
  ['Identity.ScimTokenRevoked', { level: 'info', event: 'Identity.ScimToken.Success' }],
  ['Identity.AuditExportConfigured', { level: 'info', event: 'Identity.AuditExport.Success' }],
  ['Identity.AuditExportActivated', { level: 'info', event: 'Identity.AuditExport.Success' }],
  ['Identity.AuditExportDisabled', { level: 'info', event: 'Identity.AuditExport.Success' }],

  // ----- MFA stack ---------------------------------------------------
  ['Identity.AuthFactorEnrolled', { level: 'info', event: 'Identity.Mfa.Success' }],
  ['Identity.AuthFactorRevoked', { level: 'info', event: 'Identity.Mfa.Success' }],
  ['Identity.MfaChallengeSucceeded', { level: 'info', event: 'Identity.Mfa.Success' }],
  ['Identity.MfaAnomaly', { level: 'warn', event: 'Identity.Mfa.Rejected' }],
  ['Identity.MfaLockout', { level: 'warn', event: 'Identity.Mfa.Rejected' }],
  ['Identity.RecoveryCodesGenerated', { level: 'info', event: 'Identity.Mfa.Success' }],
  ['Identity.RecoveryCodesRegenerated', { level: 'info', event: 'Identity.Mfa.Success' }],
  ['Identity.RecoveryCodeConsumed', { level: 'info', event: 'Identity.Mfa.Success' }],
  ['Identity.MfaBypassIssued', { level: 'warn', event: 'Identity.Mfa.Rejected' }],
  ['Identity.MfaBypassUsed', { level: 'warn', event: 'Identity.Mfa.Rejected' }],

  // ----- SAML --------------------------------------------------------
  ['Identity.SamlSpKeyGenerated', { level: 'info', event: 'Identity.Saml.Success' }],
  ['Identity.SamlSpKeyRotated', { level: 'info', event: 'Identity.Saml.Success' }],
  ['Identity.SamlAssertionVerified', { level: 'info', event: 'Identity.Saml.Success' }],

  // ----- Synthetic NoOp envelopes (dispatcher ignores; we still log) -
  ['Identity.SessionRevokeAllForUser.NoOp', { level: 'info', event: 'Identity.Session.Success' }],
  ['Identity.IdentityProviderActivated.NoOp', { level: 'info', event: 'Identity.Idp.Success' }],
  ['Identity.SessionMfaSatisfied.NoOp', { level: 'info', event: 'Identity.Session.Success' }],
]);

export function eventTypeToLogShape(eventType: string): LogShape {
  const hit = TABLE.get(eventType);
  if (hit) return hit;
  // Default: derive verb from the event type prefix so unclassified
  // events still land in logs as `Identity.<verb>.Emitted`. The verb
  // strips the leading `Identity.` namespace; if the prefix is wrong
  // the original type is used unchanged.
  const verb = eventType.startsWith('Identity.')
    ? eventType.slice('Identity.'.length)
    : eventType;
  return { level: 'info', event: `Identity.${verb}.Emitted` };
}
