/**
 * Typed wrappers for identity intents + queries.
 *
 * Reads go through the query-side catch-all
 * (`GET /api/v1/queries/:queryId`) — `Identity.Memberships.List` is the
 * first registered query (see `modules/identity/src/queries/registry.ts`).
 *
 * Writes go through the standard intent pipeline
 * (`POST /api/v1/intents`); the seven identity intents this slice
 * composes (`Identity.Invite.Issue`, `Identity.Invite.Accept`,
 * `Identity.User.SetPassword`, `Identity.Login.Password`,
 * `Identity.AuthSession.Issue`, …) are wrapped here so the
 * admin surfaces don't construct envelopes by hand.
 *
 * Spec: specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
 */
import { backend } from './runtime.ts';

// ─── Memberships read (catch-all) ───────────────────────────────────

export interface MembershipSummary {
  membershipId: string;
  tenantId: string;
  userId: string;
  roles: string[];
  status: 'active' | 'suspended' | 'ended';
  createdAt: string;
  updatedAt: string;
}

/**
 * Call the query-side catch-all for `Identity.Memberships.List`.
 *
 * The catch-all is reached at `/api/v1/queries/:queryId`. We use the GET
 * verb (no body) — the descriptor takes no params today.
 */
export async function listMemberships(): Promise<readonly MembershipSummary[]> {
  const result = await backend.query('/queries/Identity.Memberships.List');
  if (result === null || result === undefined) return [];
  if (!Array.isArray(result)) {
    throw new Error('listMemberships: expected array response');
  }
  return result.filter(isMembershipSummary);
}

function isMembershipSummary(v: unknown): v is MembershipSummary {
  if (typeof v !== 'object' || v === null) return false;
  return (
    'membershipId' in v && typeof Reflect.get(v, 'membershipId') === 'string' &&
    'userId' in v && typeof Reflect.get(v, 'userId') === 'string' &&
    'tenantId' in v && typeof Reflect.get(v, 'tenantId') === 'string' &&
    'roles' in v && Array.isArray(Reflect.get(v, 'roles'))
  );
}

// ─── Identity intents (writes) ──────────────────────────────────────

export interface IssueInviteInput {
  email: string;
  rolesOnAccept: string[];
}

export async function issueInvite(input: IssueInviteInput): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'Identity.Invite.Issue',
    resourceType: 'Invite',
    resourceId: null,
    email: input.email,
    rolesOnAccept: input.rolesOnAccept,
  });
}

export interface AcceptInviteInput {
  presentedToken: string;
  acceptedEmail: string;
}

export async function acceptInvite(input: AcceptInviteInput): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'Identity.Invite.Accept',
    resourceType: 'Invite',
    resourceId: null,
    presentedToken: input.presentedToken,
    acceptedEmail: input.acceptedEmail,
  });
}

export interface SetPasswordInput {
  userId: string;
  newPassword: string;
}

export async function setUserPassword(input: SetPasswordInput): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'Identity.User.SetPassword',
    resourceType: 'User',
    resourceId: input.userId,
    userId: input.userId,
    newPassword: input.newPassword,
  });
}

export interface PasswordLoginInput {
  email: string;
  password: string;
}

export async function passwordLogin(input: PasswordLoginInput): Promise<unknown> {
  return backend.mutate('/intents', {
    actionId: 'Identity.Login.Password',
    resourceType: 'Login',
    resourceId: null,
    email: input.email,
    password: input.password,
  });
}
