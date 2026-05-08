/**
 * Tenancy module — domain types.
 *
 * The on-disk projections live in the control plane and are exposed via
 * the `SignupRequestStore` + `TenantStore` ports, so types are mostly
 * re-exports for convenience plus a few command/result records that
 * cross handler boundaries.
 */

import type {
  SignupRequest,
  SignupRequestStatus,
  TenantRecord,
  TenantStatus,
} from '@atlas/ports';

export type { SignupRequest, SignupRequestStatus, TenantRecord, TenantStatus };

export interface SignupSubmitCommand {
  email: string;
  tenantSlug: string;
  organizationName: string;
  correlationId: string;
}

export interface SignupSubmitResult {
  signup: SignupRequest;
  /** True when the row already existed (idempotent retry). */
  preexisting: boolean;
}

export interface SignupApproveCommand {
  signupId: string;
  /** Admin principal performing the approval. */
  principalId: string;
  correlationId: string;
}

export interface SignupApproveResult {
  signup: SignupRequest;
  tenant: TenantRecord;
  hostname: string;
  /**
   * The plaintext invite token surfaced for the email. Returned for
   * test surfaces / play harness that want to verify the magic link
   * without parsing the email body. Routes MUST NOT log this.
   */
  magicLinkToken: string;
  magicLinkUrl: string;
}

export interface SignupDenyCommand {
  signupId: string;
  reason: string;
  principalId: string;
  correlationId: string;
}

export interface SignupDenyResult {
  signup: SignupRequest;
}

/**
 * Payload of the `Tenancy.SignupApproved` event emitted by
 * `handleSignupApprove` after the signup row has been flipped to
 * `approved`. The event is appended to the new tenant's per-tenant
 * EventStore (the tenant exists by the time we reach the emit step).
 *
 * The `cacheInvalidationTags` on the envelope MUST include
 * `Tenant:${tenantId}` and `Signup:${signupId}` so any cached
 * pending-signup queries are purged.
 *
 * Secrets stay out of event history: the magic-link plaintext token is
 * surfaced via the handler return value only — never in the payload.
 */
export interface TenancySignupApprovedPayload {
  signupId: string;
  tenantId: string;
  hostname: string;
  email: string;
  /** Admin principal who approved the signup. */
  principalId: string;
  organizationName: string;
}

export const TENANCY_SIGNUP_APPROVED_EVENT_TYPE = 'Tenancy.SignupApproved';
export const TENANCY_SIGNUP_APPROVED_SCHEMA_ID =
  'domain.tenancy.signup.approved.v1';
export const TENANCY_SIGNUP_APPROVED_SCHEMA_VERSION = 1;
