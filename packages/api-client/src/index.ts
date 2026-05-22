/**
 * Backend adapter entrypoint.
 *
 * Reads VITE_BACKEND env var to select the active backend:
 * - 'mock' (default) — in-memory data, no backend needed
 * - 'http' — calls the real ingress API
 *
 * Components import from here, never from mock/ or http/ directly. The
 * `backend` singleton itself lives in `./runtime.ts` so submodules
 * (`authz.ts`, `content-pages.ts`) can pull it in without a barrel cycle.
 */

export { backend } from './runtime.ts';

export type {
  Backend,
  BackendEventCallback,
  Unsubscribe,
  SerializedServerEvent,
  SerializedServerEventCallback,
} from './backend.ts';

export {
  listPolicies,
  getPolicy,
  createPolicy,
  activatePolicy,
  archivePolicy,
} from './authz.ts';
export type { PolicyStatus, PolicySummary, PolicyDetail } from './authz.ts';

export {
  listPages,
  getPage,
  getRenderTree,
  createPage,
  updatePage,
  deletePage,
  type PageStatus,
  type PageSummary,
  type PageDocument,
  type RenderNode,
  type RenderTree,
  type CreatePageInput,
  type UpdatePageInput,
} from './content-pages.ts';

export {
  listMemberships,
  issueInvite,
  acceptInvite,
  setUserPassword,
  passwordLogin,
  type MembershipSummary,
  type IssueInviteInput,
  type AcceptInviteInput,
  type SetPasswordInput,
  type PasswordLoginInput,
} from './identity.ts';
