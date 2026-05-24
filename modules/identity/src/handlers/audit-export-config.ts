import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  AuditExportConfigDocument,
  AuditExportS3Destination,
  AuditExportCadence,
} from '../types.ts';
import { newAuditExportConfigId, newEventId } from '../ids.ts';
import { getAuditExportConfig } from '../entities/audit-export-config.ts';

export interface AuditExportConfigureCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  destination: AuditExportS3Destination;
  cadence: AuditExportCadence;
  retentionFilter?: string[];
}

export interface AuditExportConfigureResult {
  envelope: EventEnvelope;
  document: AuditExportConfigDocument;
}

function validateDestination(d: AuditExportS3Destination): void {
  if (!d.bucket || !d.region) {
    throw new IdentityError(
      codes.AUDIT_EXPORT_DEST_INVALID,
      'destination requires bucket + region',
      400,
    );
  }
  const hasKeyAuth = d.accessKeyId && d.secretAccessKey;
  const hasRoleAuth = !!d.roleArn;
  if (!hasKeyAuth && !hasRoleAuth) {
    throw new IdentityError(
      codes.AUDIT_EXPORT_DEST_INVALID,
      'destination requires either (accessKeyId + secretAccessKey) or roleArn',
      400,
    );
  }
}

/**
 * `Identity.AuditExport.Configure` — one config per tenant. Subsequent
 * calls UPDATE the destination + cadence; cursor + run history is
 * preserved.
 */
export async function handleAuditExportConfigure(
  cmd: AuditExportConfigureCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<AuditExportConfigureResult> {
  validateDestination(cmd.destination);
  const occurredAt = new Date().toISOString();
  // Look for an existing singleton config. The id is deterministic
  // per tenant — at most one config per tenant.
  const SINGLETON_ID = `audex:${cmd.tenantId}`;
  const existing = await getAuditExportConfig(entities, cmd.tenantId, SINGLETON_ID);
  const document: AuditExportConfigDocument = existing
    ? {
        ...existing,
        destination: cmd.destination,
        cadence: cmd.cadence,
        ...(cmd.retentionFilter !== undefined
          ? { retentionFilter: [...cmd.retentionFilter] }
          : {}),
        updatedAt: occurredAt,
      }
    : {
        configId: SINGLETON_ID,
        tenantId: cmd.tenantId,
        destination: cmd.destination,
        cadence: cmd.cadence,
        status: 'configured',
        ...(cmd.retentionFilter !== undefined
          ? { retentionFilter: [...cmd.retentionFilter] }
          : {}),
        createdAt: occurredAt,
        updatedAt: occurredAt,
      };
  // Don't include configId in the singleton id closure so the helper
  // is robust to future per-tenant multi-config flows.
  void newAuditExportConfigId;
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.AuditExportConfigured',
    schemaId: 'domain.identity.audit_export.configured.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.audit-export.configure.${cmd.tenantId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Tenant-scoped config event — no User subject. The actor is in
    // `principalId`.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `AuditExportConfig:${SINGLETON_ID}`],
    retentionTag: 'retention:1y',
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}

export interface AuditExportActivateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  configId: string;
}

export interface AuditExportActivateResult {
  envelope: EventEnvelope;
  document: AuditExportConfigDocument;
}

export async function handleAuditExportActivate(
  cmd: AuditExportActivateCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<AuditExportActivateResult> {
  const existing = await getAuditExportConfig(entities, cmd.tenantId, cmd.configId);
  if (!existing) {
    throw new IdentityError(
      codes.AUDIT_EXPORT_NOT_FOUND,
      `audit export config not found: ${cmd.configId}`,
      404,
    );
  }
  const occurredAt = new Date().toISOString();
  const document: AuditExportConfigDocument = {
    ...existing,
    status: 'active',
    updatedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.AuditExportActivated',
    schemaId: 'domain.identity.audit_export.activated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.audit-export.activate.${cmd.configId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Tenant-scoped config event — no User subject. The actor is in
    // `principalId`.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `AuditExportConfig:${cmd.configId}`],
    retentionTag: 'retention:1y',
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}

export interface AuditExportDisableCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  configId: string;
}

export interface AuditExportDisableResult {
  envelope: EventEnvelope;
  document: AuditExportConfigDocument;
}

export async function handleAuditExportDisable(
  cmd: AuditExportDisableCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<AuditExportDisableResult> {
  const existing = await getAuditExportConfig(entities, cmd.tenantId, cmd.configId);
  if (!existing) {
    throw new IdentityError(
      codes.AUDIT_EXPORT_NOT_FOUND,
      `audit export config not found: ${cmd.configId}`,
      404,
    );
  }
  const occurredAt = new Date().toISOString();
  const document: AuditExportConfigDocument = {
    ...existing,
    status: 'disabled',
    updatedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.AuditExportDisabled',
    schemaId: 'domain.identity.audit_export.disabled.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.audit-export.disable.${cmd.configId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Tenant-scoped config event — no User subject. The actor is in
    // `principalId`.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `AuditExportConfig:${cmd.configId}`],
    retentionTag: 'retention:1y',
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}
