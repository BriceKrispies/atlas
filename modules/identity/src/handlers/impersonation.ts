/**
 * Phase A7 — Impersonation handlers.
 *
 * Authorization.Impersonation.Start  — operator opens a session.
 * Authorization.Impersonation.Action — emitted alongside any action a
 *   running impersonation submits (mandatory audit pair).
 * Authorization.Impersonation.End    — operator closes their own session.
 * Authorization.Impersonation.Revoke — tenant admin (or platform) ends.
 *
 * Audit retention: every emitted event carries `retention:7y`. The platform
 * tier is non-shortenable — `AuditExportConfig.retentionFilter` may extend
 * but cannot reduce.
 *
 * Reason / ticket are MANDATORY (refused with IMPERSONATION_REASON_REQUIRED
 * and IMPERSONATION_TICKET_REQUIRED). The `operatorId` must be supplied
 * by the route layer (the principal middleware resolves the platform-tenant
 * principal).
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  ImpersonationEndReason,
  ImpersonationSessionDocument,
} from '../types.ts';
import { newEventId, newImpersonationId } from '../ids.ts';
import {
  generateSecret,
  hashSecret,
  lookupOf,
} from '../crypto/secret-hash.ts';
import {
  getImpersonationSessionEntity,
  putImpersonationSessionEntity,
} from '../entities/impersonation-session.ts';

/** Platform-side retention tier — tenants cannot shorten. */
export const IMPERSONATION_RETENTION_TAG = 'retention:7y';

const MAX_DURATION_HARD_CAP_MIN = 8 * 60; // 8 hours
const DEFAULT_DURATION_MIN = 30;

// =====================================================================
// Start
// =====================================================================

export interface ImpersonationStartCommand {
  tenantId: string;
  correlationId: string;
  /** Operator's principal id — required (this is the auditable actor). */
  operatorId: string;
  /** UserId being impersonated within `tenantId`. */
  targetUserId: string;
  /** Free-form justification — required, non-empty. */
  reason: string;
  /** Support-ticket / incident URL — required. */
  ticketUrl: string;
  /** Window in minutes. Default 30, hard-capped at 8h. */
  maxDurationMin?: number;
  /**
   * Resource types this impersonation cannot mutate. Routed from tenant
   * policy by the caller (we don't read tenant policy here — keep
   * handlers pure).
   */
  readonlyResourceTypes?: ReadonlyArray<string>;
}

export interface ImpersonationStartResult {
  envelope: EventEnvelope;
  document: ImpersonationSessionDocument;
  /** Plaintext token. Surfaced ONCE; the operator carries it as Bearer. */
  plaintextToken: string;
  /** `<impersonationId>.<secret>` — wire shape. */
  bearerToken: string;
}

export async function handleImpersonationStart(
  cmd: ImpersonationStartCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<ImpersonationStartResult> {
  if (!cmd.operatorId) {
    throw new IdentityError(
      codes.IMPERSONATION_REQUIRES_OPERATOR,
      'Impersonation.Start requires an operatorId',
      403,
    );
  }
  if (!cmd.reason || cmd.reason.trim().length === 0) {
    throw new IdentityError(
      codes.IMPERSONATION_REASON_REQUIRED,
      'Impersonation.Start requires a non-empty reason',
      400,
    );
  }
  if (!cmd.ticketUrl || cmd.ticketUrl.trim().length === 0) {
    throw new IdentityError(
      codes.IMPERSONATION_TICKET_REQUIRED,
      'Impersonation.Start requires a ticketUrl',
      400,
    );
  }
  const duration = cmd.maxDurationMin ?? DEFAULT_DURATION_MIN;
  if (duration <= 0 || duration > MAX_DURATION_HARD_CAP_MIN) {
    throw new IdentityError(
      codes.IMPERSONATION_DURATION_INVALID,
      `maxDurationMin must be 1..${MAX_DURATION_HARD_CAP_MIN}`,
      400,
    );
  }
  const occurredAt = new Date().toISOString();
  const impersonationId = newImpersonationId();
  const secret = generateSecret();
  const document: ImpersonationSessionDocument = {
    impersonationId,
    tenantId: cmd.tenantId,
    operatorId: cmd.operatorId,
    targetUserId: cmd.targetUserId,
    reason: cmd.reason,
    ticketUrl: cmd.ticketUrl,
    maxDurationMin: duration,
    tokenHash: hashSecret(secret),
    tokenLookup: lookupOf(secret),
    status: 'active',
    issuedAt: occurredAt,
    expiresAt: new Date(Date.now() + duration * 60 * 1000).toISOString(),
    ...(cmd.readonlyResourceTypes !== undefined
      ? { readonlyResourceTypes: cmd.readonlyResourceTypes }
      : {}),
  };
  await putImpersonationSessionEntity(entities, document);
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Authorization.ImpersonationStarted',
    schemaId: 'domain.authorization.impersonation_started.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `authz.impersonation.start.${impersonationId}`,
    causationId: null,
    principalId: cmd.operatorId,
    userId: cmd.targetUserId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${cmd.targetUserId}`,
      `Impersonation:${impersonationId}`,
    ],
    retentionTag: IMPERSONATION_RETENTION_TAG,
    payload: {
      impersonationId,
      operatorId: cmd.operatorId,
      targetUserId: cmd.targetUserId,
      reason: cmd.reason,
      ticketUrl: cmd.ticketUrl,
      maxDurationMin: duration,
      expiresAt: document.expiresAt,
    },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return {
    envelope,
    document,
    plaintextToken: secret,
    bearerToken: `${impersonationId}.${secret}`,
  };
}

// =====================================================================
// Action — emitted alongside any action a running impersonation submits.
// =====================================================================

export interface ImpersonationActionCommand {
  tenantId: string;
  correlationId: string;
  impersonationId: string;
  operatorId: string;
  targetUserId: string;
  /** The action id (e.g. `ContentPages.Page.Update`) being audited. */
  actionId: string;
  /** Optional resource type the action targets. */
  resourceType?: string;
  /** Optional resource id the action targets. */
  resourceId?: string;
}

export interface ImpersonationActionResult {
  envelope: EventEnvelope;
}

export async function handleImpersonationAction(
  cmd: ImpersonationActionCommand,
  eventStore: EventStore,
): Promise<ImpersonationActionResult> {
  const occurredAt = new Date().toISOString();
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Authorization.ImpersonationAction',
    schemaId: 'domain.authorization.impersonation_action.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `authz.impersonation.action.${cmd.impersonationId}.${cmd.correlationId}`,
    causationId: null,
    principalId: cmd.operatorId,
    userId: cmd.targetUserId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `Impersonation:${cmd.impersonationId}`,
    ],
    retentionTag: IMPERSONATION_RETENTION_TAG,
    payload: {
      impersonationId: cmd.impersonationId,
      operatorId: cmd.operatorId,
      targetUserId: cmd.targetUserId,
      actionId: cmd.actionId,
      ...(cmd.resourceType !== undefined
        ? { resourceType: cmd.resourceType }
        : {}),
      ...(cmd.resourceId !== undefined ? { resourceId: cmd.resourceId } : {}),
    },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope };
}

// =====================================================================
// End / Revoke — both transition status off `'active'`.
// =====================================================================

export interface ImpersonationEndCommand {
  tenantId: string;
  correlationId: string;
  impersonationId: string;
  /** Principal closing the session. Operator on End; tenant admin on Revoke. */
  principalId: string;
  reason: ImpersonationEndReason;
}

export interface ImpersonationEndResult {
  envelope: EventEnvelope;
  document: ImpersonationSessionDocument;
}

export async function handleImpersonationEnd(
  cmd: ImpersonationEndCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<ImpersonationEndResult> {
  const existing = await getImpersonationSessionEntity(
    entities,
    cmd.tenantId,
    cmd.impersonationId,
  );
  if (!existing) {
    throw new IdentityError(
      codes.IMPERSONATION_NOT_FOUND,
      'impersonation session not found',
      404,
    );
  }
  if (existing.status !== 'active') {
    throw new IdentityError(
      codes.IMPERSONATION_ENDED,
      `impersonation session in status ${existing.status}`,
      409,
    );
  }
  const occurredAt = new Date().toISOString();
  const next: ImpersonationSessionDocument = {
    ...existing,
    status: cmd.reason === 'tenant_revoked' || cmd.reason === 'platform_revoked'
      ? 'revoked'
      : cmd.reason === 'auto_expired'
        ? 'expired'
        : 'ended',
    endedAt: occurredAt,
    endReason: cmd.reason,
    ...(cmd.reason === 'tenant_revoked' || cmd.reason === 'platform_revoked'
      ? { revokedBy: cmd.principalId }
      : {}),
  };
  await putImpersonationSessionEntity(entities, next);
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Authorization.ImpersonationEnded',
    schemaId: 'domain.authorization.impersonation_ended.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `authz.impersonation.end.${cmd.impersonationId}.${cmd.reason}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: existing.targetUserId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${existing.targetUserId}`,
      `Impersonation:${cmd.impersonationId}`,
    ],
    retentionTag: IMPERSONATION_RETENTION_TAG,
    payload: {
      impersonationId: cmd.impersonationId,
      operatorId: existing.operatorId,
      targetUserId: existing.targetUserId,
      reason: cmd.reason,
      endedBy: cmd.principalId,
    },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document: next };
}

/**
 * Resolves an impersonation token (`<id>.<secret>` bearer shape) against
 * the entity store. Treats expired sessions as expired (caller MAY auto-end
 * them; we don't mutate state on the read path). Returns `null` when the
 * token is malformed, missing, or hash-mismatched.
 */
export async function resolveImpersonationToken(
  entities: EntityStore,
  tenantId: string,
  bearer: string,
):
  Promise<
    | { ok: true; document: ImpersonationSessionDocument }
    | { ok: false; reason: 'malformed' | 'not_found' | 'hash_mismatch' | 'expired' | 'revoked' | 'ended' }
  > {
  const dot = bearer.indexOf('.');
  if (dot === -1) return { ok: false, reason: 'malformed' };
  const id = bearer.slice(0, dot);
  const secret = bearer.slice(dot + 1);
  if (!id || !secret) return { ok: false, reason: 'malformed' };
  const doc = await getImpersonationSessionEntity(entities, tenantId, id);
  if (!doc) return { ok: false, reason: 'not_found' };
  if (hashSecret(secret) !== doc.tokenHash) {
    return { ok: false, reason: 'hash_mismatch' };
  }
  if (doc.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (doc.status === 'ended') return { ok: false, reason: 'ended' };
  if (doc.status === 'expired') return { ok: false, reason: 'expired' };
  if (new Date(doc.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, document: doc };
}
