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
