// PolicyStore + its types were promoted to @atlas/ports (Ring 1) per ADR 0016.
// Re-exported here so existing @atlas/authz consumers keep their import path.
export type {
  PolicyStatus,
  PolicySummary,
  PolicyDetail,
  PolicyStore,
} from '@atlas/ports';
export {
  handleCreatePolicy,
  type CreatePolicyCommand,
  type CreatePolicyResult,
} from './handlers/create-policy.ts';
export {
  handleActivatePolicy,
  type ActivatePolicyCommand,
} from './handlers/activate-policy.ts';
export {
  handleArchivePolicy,
  type ArchivePolicyCommand,
} from './handlers/archive-policy.ts';
export {
  authzHandlerEntries,
  authzHandlerRegistry,
  composeRegistries,
} from './handlers/registry.ts';
export { AuthzError, codes as authzErrorCodes } from './errors.ts';

// Action-driven query registry — substrate-only stub today (authz reads
// migrate onto the catch-all in a follow-up slice).
export { authzQueryRegistry } from './queries/registry.ts';
