import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { MfaBypassDocument } from '../types.ts';
import { newEventId, newMfaBypassId } from '../ids.ts';
import {
  constantTimeEqual,
  generateSecret,
  hashSecret,
  lookupOf,
} from '../crypto/secret-hash.ts';
import {
  findMfaBypassesByLookup,
  getMfaBypassEntity,
  putMfaBypassEntity,
} from '../entities/mfa-bypass.ts';

const DEFAULT_BYPASS_TTL_SECONDS = 5 * 60;

// =====================================================================
// Issue (admin)
// =====================================================================

export interface MfaBypassIssueCommand {
  tenantId: string;
  correlationId: string;
  /** Admin issuing the bypass — REQUIRED (audit trail). */
  principalId: string;
  /** User the bypass is for. */
  userId: string;
  ttlSeconds?: number;
}

export interface MfaBypassIssueResult {
  envelope: EventEnvelope;
  document: MfaBypassDocument;
  /** Plaintext bypass secret. Surfaced ONCE — admin delivers OOB. */
  plaintextSecret: string;
}

export async function handleMfaBypassIssue(
  cmd: MfaBypassIssueCommand,
  eventStore: EventStore,
): Promise<MfaBypassIssueResult> {
  if (!cmd.principalId) {
    throw new IdentityError(
      codes.IDENTITY_INVALID,
      'MfaBypass.Issue requires an admin principalId for audit',
      400,
    );
  }
  const occurredAt = new Date().toISOString();
  const ttl = cmd.ttlSeconds ?? DEFAULT_BYPASS_TTL_SECONDS;
  const bypassId = newMfaBypassId();
  const secret = generateSecret();
  const document: MfaBypassDocument = {
    bypassId,
    tenantId: cmd.tenantId,
    userId: cmd.userId,
    issuedBy: cmd.principalId,
    secretHash: hashSecret(secret),
    secretLookup: lookupOf(secret),
    status: 'pending',
    issuedAt: occurredAt,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.MfaBypassIssued',
    schemaId: 'domain.identity.mfa.bypass_issued.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.mfa.bypass.issue.${bypassId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${cmd.userId}`,
      `MfaBypass:${bypassId}`,
    ],
    retentionTag: 'retention:1y',
    payload: { document, issuedBy: cmd.principalId },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document, plaintextSecret: secret };
}

// =====================================================================
// Use (user redeems)
// =====================================================================

export interface MfaBypassUseCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  userId: string;
  presentedSecret: string;
}

export interface MfaBypassUseResult {
  envelope: EventEnvelope;
  document: MfaBypassDocument;
}

export async function handleMfaBypassUse(
  cmd: MfaBypassUseCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<MfaBypassUseResult> {
  const candidates = await findMfaBypassesByLookup(
    entities,
    cmd.tenantId,
    cmd.userId,
    lookupOf(cmd.presentedSecret),
  );
  const presentedHash = hashSecret(cmd.presentedSecret);
  let matched: MfaBypassDocument | null = null;
  for (const c of candidates) {
    if (constantTimeEqual(c.secretHash, presentedHash)) {
      matched = c;
      break;
    }
  }
  if (!matched) {
    throw new IdentityError(
      codes.BYPASS_TOKEN_NOT_FOUND,
      'bypass token not found',
      401,
    );
  }
  if (matched.status === 'used') {
    throw new IdentityError(
      codes.BYPASS_TOKEN_USED,
      'bypass token already used',
      401,
    );
  }
  if (matched.status !== 'pending') {
    throw new IdentityError(
      codes.BYPASS_TOKEN_EXPIRED,
      `bypass token in status ${matched.status}`,
      401,
    );
  }
  if (new Date(matched.expiresAt).getTime() <= Date.now()) {
    throw new IdentityError(
      codes.BYPASS_TOKEN_EXPIRED,
      'bypass token expired',
      401,
    );
  }
  const occurredAt = new Date().toISOString();
  const used: MfaBypassDocument = {
    ...matched,
    status: 'used',
    usedAt: occurredAt,
  };
  await putMfaBypassEntity(entities, used);
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.MfaBypassUsed',
    schemaId: 'domain.identity.mfa.bypass_used.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.mfa.bypass.use.${matched.bypassId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${cmd.userId}`,
      `MfaBypass:${matched.bypassId}`,
    ],
    retentionTag: 'retention:1y',
    payload: {
      document: used,
      issuedBy: matched.issuedBy,
      method: 'mfa_bypass',
    },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  void getMfaBypassEntity; // exported for queries.ts use
  return { envelope, document: used };
}
