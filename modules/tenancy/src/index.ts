/**
 * @atlas/tenancy — first vertical slice.
 *
 * Owns the public-signup → admin-approval flow. Tenant provisioning
 * (DB + custom domain) happens in `signup-approve.ts`; per-tenant
 * identity bootstrap (admin User + Membership) is delegated back to
 * `@atlas/identity`'s `handleInviteIssue` via a route-supplied
 * `issueInvite` callback so this module stays pure (only depends on
 * `@atlas/ports`).
 *
 * No dispatcher: the projection (`control_plane.signup_requests`)
 * lives in the control plane and is written directly by the handlers
 * via `SignupRequestStore`. There is no per-tenant event store at
 * signup time (no tenant exists yet).
 */

export {
  TenancyError,
  codes as tenancyErrorCodes,
  type TenancyErrorCode,
} from './errors.ts';

export {
  newSignupRequestId,
  isValidTenantSlug,
  tenantHostnameFor,
} from './ids.ts';

export type {
  SignupRequest,
  SignupRequestStatus,
  TenantRecord,
  TenantStatus,
  SignupSubmitCommand,
  SignupSubmitResult,
  SignupApproveCommand,
  SignupApproveResult,
  SignupDenyCommand,
  SignupDenyResult,
  TenancySignupApprovedPayload,
} from './types.ts';

export {
  TENANCY_SIGNUP_APPROVED_EVENT_TYPE,
  TENANCY_SIGNUP_APPROVED_SCHEMA_ID,
  TENANCY_SIGNUP_APPROVED_SCHEMA_VERSION,
} from './types.ts';

export {
  handleSignupSubmit,
  type SignupSubmitDeps,
} from './handlers/signup-submit.ts';

export {
  handleSignupApprove,
  type SignupApproveDeps,
} from './handlers/signup-approve.ts';

export {
  handleSignupDeny,
  type SignupDenyDeps,
} from './handlers/signup-deny.ts';
