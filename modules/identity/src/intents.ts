/**
 * Typed payload union for every `Identity.*` intent dispatched through
 * the platform's `HandlerRegistry`.
 *
 * Each variant carries the discriminating `actionId` literal so that
 * `payload as IdentityIntentPayload` (or a `switch (payload.actionId)`)
 * narrows to the right field set automatically — no
 * `as Record<string, unknown>` + `readString` shim is needed.
 *
 * **Shape source.** The shapes mirror the handler `XCommand` interfaces
 * one-for-one (minus the four fields the registry lifts off
 * `IntentHandlerContext`: `tenantId`, `correlationId`, `principalId`,
 * plus the implicit `userId` only attached to envelopes for events).
 * If you add a handler-side field, add it here too — both are
 * AJV-validated against the same schema at ingress, so they MUST agree.
 *
 * **Why not auto-derive from `packages/schemas`?** The generated TS
 * types under `packages/schemas/src/generated/` describe the *wire*
 * shape (snake_case in some places, optional-vs-required differences,
 * union arms not yet flattened). Hand-writing the payload union here
 * keeps the registry honest against the *handler* contract, which is
 * the one that actually matters at runtime — schema validation already
 * guarantees the wire→handler bridge.
 */

import type { IntentPayload } from '@atlas/platform-core';
import type { SessionEndReason } from './types.ts';
import type { OidcDiscoveryDocument, RoleMapping } from './types.ts';

// --------------------------------------------------------------------
// Phase A1 — users, memberships, invites, passwords, password-login.
// --------------------------------------------------------------------

export interface UserCreatePayload extends IntentPayload {
  actionId: 'Identity.User.Create';
  resourceType: 'User';
  email: string;
  userId?: string;
  primaryIdpSubject?: string;
  givenName?: string;
  familyName?: string;
}

export interface MembershipCreatePayload extends IntentPayload {
  actionId: 'Identity.Membership.Create';
  resourceType: 'Membership';
  userId: string;
  roles: string[];
}

export interface InviteIssuePayload extends IntentPayload {
  actionId: 'Identity.Invite.Issue';
  resourceType: 'Invite';
  email: string;
  rolesOnAccept: string[];
  ttlSeconds?: number;
}

export interface InviteAcceptPayload extends IntentPayload {
  actionId: 'Identity.Invite.Accept';
  resourceType: 'Invite';
  presentedToken: string;
  acceptedEmail: string;
  primaryIdpSubject?: string;
  givenName?: string;
  familyName?: string;
}

export interface PasswordSetPayload extends IntentPayload {
  actionId: 'Identity.User.SetPassword';
  resourceType: 'User';
  userId: string;
  newPassword: string;
}

export interface PasswordLoginPayload extends IntentPayload {
  actionId: 'Identity.Login.Password';
  resourceType: 'Login';
  email: string;
  password: string;
  attemptIp?: string;
  attemptUserAgent?: string;
}

// --------------------------------------------------------------------
// Phase A2 — sessions.
// --------------------------------------------------------------------

export interface SessionIssuePayload extends IntentPayload {
  actionId: 'Identity.AuthSession.Issue';
  resourceType: 'AuthSession';
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface SessionRefreshPayload extends IntentPayload {
  actionId: 'Identity.AuthSession.Refresh';
  resourceType: 'AuthSession';
  sessionId: string;
  presentedRefreshSecret: string;
  ip?: string;
  userAgent?: string;
}

export interface SessionRevokePayload extends IntentPayload {
  actionId: 'Identity.AuthSession.Revoke';
  resourceType: 'AuthSession';
  sessionId: string;
  reason?: SessionEndReason;
}

export interface SessionRevokeAllForUserPayload extends IntentPayload {
  actionId: 'Identity.AuthSession.RevokeAllForUser';
  resourceType: 'AuthSession';
  userId: string;
  reason?: SessionEndReason;
}

// --------------------------------------------------------------------
// Phase A2.7-A2.9 — service credentials.
// --------------------------------------------------------------------

export interface ApiKeyCreatePayload extends IntentPayload {
  actionId: 'Identity.ApiKey.Create';
  resourceType: 'ApiKey';
  name: string;
  scopes: string[];
  userId?: string;
  servicePrincipalId?: string;
  expiresAt?: string;
}

export interface ApiKeyRotatePayload extends IntentPayload {
  actionId: 'Identity.ApiKey.Rotate';
  resourceType: 'ApiKey';
  keyId: string;
}

export interface ApiKeyRevokePayload extends IntentPayload {
  actionId: 'Identity.ApiKey.Revoke';
  resourceType: 'ApiKey';
  keyId: string;
}

export interface ServicePrincipalCreatePayload extends IntentPayload {
  actionId: 'Identity.ServicePrincipal.Create';
  resourceType: 'ServicePrincipal';
  ownerUserId: string;
  displayName: string;
  scopes: string[];
}

export interface ServicePrincipalSetScopesPayload extends IntentPayload {
  actionId: 'Identity.ServicePrincipal.SetScopes';
  resourceType: 'ServicePrincipal';
  spId: string;
  scopes: string[];
}

export interface ServicePrincipalDisablePayload extends IntentPayload {
  actionId: 'Identity.ServicePrincipal.Disable';
  resourceType: 'ServicePrincipal';
  spId: string;
}

// --------------------------------------------------------------------
// Phase A3 — federated OIDC.
// --------------------------------------------------------------------

export interface IdpConfigurePayload extends IntentPayload {
  actionId: 'Identity.IdentityProvider.Configure';
  resourceType: 'IdentityProvider';
  displayName: string;
  issuer: string;
  audience: string;
  jwksUri?: string;
  groupClaimPath?: string;
  discoveryDocument?: OidcDiscoveryDocument;
  requireInvite?: boolean;
  defaultRolesOnFirstLogin?: string[];
  roleMappings?: RoleMapping[];
  priority?: number;
}

export interface IdpActivatePayload extends IntentPayload {
  actionId: 'Identity.IdentityProvider.Activate';
  resourceType: 'IdentityProvider';
  idpId: string;
}

export interface IdpDisablePayload extends IntentPayload {
  actionId: 'Identity.IdentityProvider.Disable';
  resourceType: 'IdentityProvider';
  idpId: string;
}

export interface IdpRotateJwksPayload extends IntentPayload {
  actionId: 'Identity.IdentityProvider.RotateJwks';
  resourceType: 'IdentityProvider';
  idpId: string;
  jwksUri?: string;
  discoveryDocument?: OidcDiscoveryDocument;
}

/**
 * Discriminated union of every identity-action payload the platform's
 * `HandlerRegistry` dispatches. The discriminator is `actionId`.
 *
 * NOT exhaustive vs. `@atlas/identity`'s full handler surface — only
 * the actions that are reachable through the `/api/v1/intents` ingress
 * (the registry built by `identityHandlerEntries`). The OAuth token
 * pair (`handleOAuthIssueToken` / `handleOAuthRevokeToken`) and the
 * Phase A4+ handlers (SCIM, MFA, SAML, impersonation, break-glass) have
 * dedicated routes that bypass the intent registry, so they are *not*
 * included here. When one is moved to intent dispatch, add the
 * corresponding payload variant + registry entry in the same commit.
 */
export type IdentityIntentPayload =
  | UserCreatePayload
  | MembershipCreatePayload
  | InviteIssuePayload
  | InviteAcceptPayload
  | PasswordSetPayload
  | PasswordLoginPayload
  | SessionIssuePayload
  | SessionRefreshPayload
  | SessionRevokePayload
  | SessionRevokeAllForUserPayload
  | ApiKeyCreatePayload
  | ApiKeyRotatePayload
  | ApiKeyRevokePayload
  | ServicePrincipalCreatePayload
  | ServicePrincipalSetScopesPayload
  | ServicePrincipalDisablePayload
  | IdpConfigurePayload
  | IdpActivatePayload
  | IdpDisablePayload
  | IdpRotateJwksPayload;
