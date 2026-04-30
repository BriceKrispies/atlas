import type { EventEnvelope } from '@atlas/platform-core';
import type { PolicyStore } from '../policy-store.ts';

export interface ArchivePolicyCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  version: number;
}

function newEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function handleArchivePolicy(
  cmd: ArchivePolicyCommand,
  store: PolicyStore,
): Promise<{ envelope: EventEnvelope }> {
  // Store implementation refuses if this is the sole active row for the
  // tenant — see PolicyStore.archive contract.
  await store.archive({
    tenantId: cmd.tenantId,
    version: cmd.version,
    principalId: cmd.principalId,
  });

  const occurredAt = new Date().toISOString();
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Authz.PolicyArchived',
    schemaId: 'authz.policy.archive.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `authz.policy.archive.${cmd.tenantId}.${cmd.version}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`],
    payload: {
      tenantId: cmd.tenantId,
      version: cmd.version,
      status: 'archived',
    },
  };

  return { envelope };
}
