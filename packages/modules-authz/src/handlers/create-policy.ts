import type { EventEnvelope } from '@atlas/platform-core';
import { AuthzError, codes } from '../errors.ts';
import type { PolicyStore } from '../policy-store.ts';

export interface CreatePolicyCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  cedarText: string;
  description: string | null;
}

export interface CreatePolicyResult {
  envelope: EventEnvelope;
  version: number;
}

function newEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Validate the cedar text *parses* (cheap structural check only — the
 * full schema-aware validation belongs to `pnpm cedar:check` and the
 * authoring UI's lazy-loaded simulator). Empty text is rejected so a
 * mistyped save doesn't blank a tenant on activation.
 */
function preflightCedar(cedarText: string): void {
  const trimmed = cedarText.trim();
  if (trimmed.length === 0) {
    throw new AuthzError(codes.POLICY_TEXT_INVALID, 'cedarText must be non-empty');
  }
  // The handler intentionally does NOT call cedar-wasm here — that would
  // pull the WASM artefact into the per-request hot path. The authoring
  // UI surfaces parse errors to the user before save; cedar-wasm static
  // analysis runs in CI via `pnpm cedar:check`. The DB stores whatever
  // the admin saved; activate is the gate that matters for policy
  // evaluation, and a malformed bundle simply fails-closed at evaluate
  // time (CedarPolicyEngine treats parse failures as deny — see
  // `cedar-policy-engine.ts`).
}

export async function handleCreatePolicy(
  cmd: CreatePolicyCommand,
  store: PolicyStore,
): Promise<CreatePolicyResult> {
  preflightCedar(cmd.cedarText);

  const version = await store.createDraft({
    tenantId: cmd.tenantId,
    cedarText: cmd.cedarText,
    description: cmd.description,
    principalId: cmd.principalId,
  });

  const occurredAt = new Date().toISOString();
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Authz.PolicyDrafted',
    schemaId: 'authz.policy.create.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `authz.policy.create.${cmd.tenantId}.${version}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`],
    payload: {
      tenantId: cmd.tenantId,
      version,
      status: 'draft',
      lastModifiedBy: cmd.principalId,
    },
  };

  return { envelope, version };
}
