import type { EventEnvelope } from '@atlas/platform-core';
import type { PolicyStore } from '../policy-store.ts';

export interface ActivatePolicyCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  version: number;
}

function newEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function handleActivatePolicy(
  cmd: ActivatePolicyCommand,
  store: PolicyStore,
): Promise<{ envelope: EventEnvelope }> {
  // The store does the demote-prior-active + promote-target in a single
  // transaction; the partial unique index on (tenant_id) WHERE
  // status='active' enforces "exactly one active" at the DB.
  await store.activate({
    tenantId: cmd.tenantId,
    version: cmd.version,
    principalId: cmd.principalId,
  });

  const occurredAt = new Date().toISOString();
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Authz.PolicyActivated',
    schemaId: 'authz.policy.activate.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `authz.policy.activate.${cmd.tenantId}.${cmd.version}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    // Cache-tag invalidation: the engine's per-tenant bundle cache is
    // dropped on this tag (see `wirePolicyCacheInvalidation` in the
    // cedar adapter). Without this tag, a freshly-activated bundle
    // wouldn't take effect until the next process restart.
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`],
    payload: {
      tenantId: cmd.tenantId,
      version: cmd.version,
      status: 'active',
    },
  };

  return { envelope };
}
