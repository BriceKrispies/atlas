/**
 * SignupRequestStore — control-plane-scoped self-service signup queue.
 *
 * Lives outside any tenant: rows here represent prospective tenants that
 * have not yet been provisioned. On approval the tenancy module
 * 1. inserts a row into `control_plane.tenants` (via `TenantStore`),
 * 2. registers a custom domain (via `CustomDomainStore`),
 * 3. issues an invite token in the new tenant's per-tenant DB (via
 *    identity's `Identity.Invite.Issue` handler),
 * 4. dispatches a magic-link email (via `Mailer`),
 * 5. marks this row `approved`.
 *
 * Idempotency is on `(email, tenantSlug)`. Re-submitting the same pair
 * returns the existing row.
 */
export type SignupRequestStatus = 'pending' | 'approved' | 'denied';

export interface SignupRequest {
  signupId: string;
  email: string;
  tenantSlug: string;
  organizationName: string;
  status: SignupRequestStatus;
  /** Non-null after the dispatcher provisions the tenant. */
  approvedTenantId: string | null;
  deniedReason: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSignupRequestInput {
  signupId: string;
  email: string;
  tenantSlug: string;
  organizationName: string;
  correlationId: string;
}

export interface SignupRequestStore {
  /**
   * Insert a new pending row. If an existing row matches by
   * `(email, tenantSlug)`, return that row instead of creating a new one
   * (idempotency).
   */
  create(input: CreateSignupRequestInput): Promise<SignupRequest>;

  get(signupId: string): Promise<SignupRequest | null>;

  /**
   * Filter by status, ordered by `createdAt` ascending. `limit` defaults
   * to 50.
   */
  list(filter?: { status?: SignupRequestStatus; limit?: number }): Promise<SignupRequest[]>;

  /**
   * Mark a pending row approved with the resolved tenantId. Throws when
   * the row is missing or already terminal (approved / denied).
   */
  markApproved(signupId: string, tenantId: string): Promise<SignupRequest>;

  markDenied(signupId: string, reason: string): Promise<SignupRequest>;
}
