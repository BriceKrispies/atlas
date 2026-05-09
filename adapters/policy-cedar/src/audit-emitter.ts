/**
 * Back-compat shim — pure helpers + types live in `@atlas/ports`
 * (`audit-emitter.ts`) per ADR 0008 / Stage 1 / Slice 1.6. This file
 * re-exports the same surface so existing imports of
 * `@atlas/adapter-policy-cedar`'s audit-emitter API keep working;
 * new code should import from `@atlas/ports` directly.
 */

export {
  POLICY_EVALUATED_SCHEMA_ID,
  POLICY_EVALUATED_EVENT_TYPE,
  policyEvaluatedEvent,
  shouldEmitPolicyEvaluated,
} from '@atlas/ports';
export type {
  PolicyEvaluatedPayload,
  PolicyEvaluatedEventOptions,
} from '@atlas/ports';
