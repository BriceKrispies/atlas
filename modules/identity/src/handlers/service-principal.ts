import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { ServicePrincipalDocument } from '../types.ts';
import { newEventId, newServicePrincipalId } from '../ids.ts';
import {
  getServicePrincipalEntity,
} from '../entities/service-principal.ts';

export interface ServicePrincipalCreateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  /** UserId of the operator creating the SP. */
  ownerUserId: string;
  displayName: string;
  scopes: string[];
}

export interface ServicePrincipalCreateResult {
  envelope: EventEnvelope;
  document: ServicePrincipalDocument;
}

export async function handleServicePrincipalCreate(
  cmd: ServicePrincipalCreateCommand,
  eventStore: EventStore,
): Promise<ServicePrincipalCreateResult> {
  const occurredAt = new Date().toISOString();
  const spId = newServicePrincipalId();
  const document: ServicePrincipalDocument = {
    spId,
    tenantId: cmd.tenantId,
    displayName: cmd.displayName,
    ownerUserId: cmd.ownerUserId,
    scopes: [...cmd.scopes],
    status: 'active',
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ServicePrincipalCreated',
    schemaId: 'domain.identity.service_principal.created.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.sp.create.${spId}`,
    causationId: null,
    principalId: cmd.principalId,
    // Subject is the ServicePrincipal (a non-User principal), not a User and
    // not the actor. No User subject → null. The actor is in `principalId`;
    // the human owner is `document.ownerUserId` in the payload.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ServicePrincipal:${spId}`],
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}

export interface ServicePrincipalSetScopesCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  spId: string;
  scopes: string[];
}

export interface ServicePrincipalSetScopesResult {
  envelope: EventEnvelope;
  document: ServicePrincipalDocument;
}

export async function handleServicePrincipalSetScopes(
  cmd: ServicePrincipalSetScopesCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<ServicePrincipalSetScopesResult> {
  const existing = await getServicePrincipalEntity(entities, cmd.tenantId, cmd.spId);
  if (!existing) {
    throw new IdentityError(
      codes.SERVICE_PRINCIPAL_NOT_FOUND,
      `service principal not found: ${cmd.spId}`,
      404,
    );
  }
  const occurredAt = new Date().toISOString();
  const updated: ServicePrincipalDocument = {
    ...existing,
    scopes: [...cmd.scopes],
    updatedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ServicePrincipalScopesChanged',
    schemaId: 'domain.identity.service_principal.scopes_changed.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.sp.set-scopes.${cmd.spId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Subject is the ServicePrincipal (a non-User principal), not the actor.
    // No User subject → null.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ServicePrincipal:${cmd.spId}`],
    payload: { document: updated },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document: updated };
}

export interface ServicePrincipalDisableCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  spId: string;
}

export interface ServicePrincipalDisableResult {
  envelope: EventEnvelope;
  document: ServicePrincipalDocument;
}

export async function handleServicePrincipalDisable(
  cmd: ServicePrincipalDisableCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<ServicePrincipalDisableResult> {
  const existing = await getServicePrincipalEntity(entities, cmd.tenantId, cmd.spId);
  if (!existing) {
    throw new IdentityError(
      codes.SERVICE_PRINCIPAL_NOT_FOUND,
      `service principal not found: ${cmd.spId}`,
      404,
    );
  }
  const occurredAt = new Date().toISOString();
  const disabled: ServicePrincipalDocument = {
    ...existing,
    status: 'disabled',
    disabledAt: occurredAt,
    ...(cmd.principalId !== null ? { disabledBy: cmd.principalId } : {}),
    updatedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ServicePrincipalDisabled',
    schemaId: 'domain.identity.service_principal.disabled.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.sp.disable.${cmd.spId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Subject is the ServicePrincipal (a non-User principal), not the actor.
    // No User subject → null.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ServicePrincipal:${cmd.spId}`],
    payload: { document: disabled },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document: disabled };
}
