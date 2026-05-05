import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  IdentityPolicy,
  RecoveryCodeDocument,
} from '../types.ts';
import { DEFAULT_IDENTITY_POLICY } from '../types.ts';
import {
  newEventId,
  newRecoveryBatchId,
  newRecoveryCodeId,
} from '../ids.ts';
import {
  constantTimeEqual,
  generateSecret,
  hashSecret,
  lookupOf,
} from '../crypto/secret-hash.ts';
import {
  findRecoveryCodesByLookup,
  listRecoveryCodesForUser,
  putRecoveryCodeEntity,
} from '../entities/recovery-code.ts';

// =====================================================================
// Generate (initial) + Regenerate.
// =====================================================================

export interface GenerateRecoveryCodesCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  userId: string;
  policy?: IdentityPolicy;
}

export interface GenerateRecoveryCodesResult {
  envelope: EventEnvelope;
  /**
   * Plaintext codes — surfaced ONCE. Persisted entries hold only the
   * Argon2id hash. The route layer renders these to the user
   * IMMEDIATELY (with a "save these now" warning); subsequent fetches
   * cannot retrieve them.
   */
  plaintextCodes: string[];
  documents: RecoveryCodeDocument[];
}

/**
 * Generate a fresh batch of recovery codes. Use Regenerate when codes
 * already exist for the user — it invalidates the prior batch.
 */
export async function handleGenerateRecoveryCodes(
  cmd: GenerateRecoveryCodesCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<GenerateRecoveryCodesResult> {
  const policy = cmd.policy ?? DEFAULT_IDENTITY_POLICY;
  // Refuse when codes already exist — caller should use Regenerate
  // explicitly (audit signal: regen is a different security event
  // than initial generation).
  const existing = await listRecoveryCodesForUser(entities, cmd.tenantId, cmd.userId);
  const hasActive = existing.some((c) => c.status === 'active');
  if (hasActive) {
    throw new IdentityError(
      codes.RECOVERY_CODE_INVALID,
      `recovery codes already exist for user ${cmd.userId}; use regenerate instead`,
      409,
    );
  }
  return mintBatch(cmd, eventStore, entities, policy.recoveryCodeCount, false);
}

export async function handleRegenerateRecoveryCodes(
  cmd: GenerateRecoveryCodesCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<GenerateRecoveryCodesResult> {
  const policy = cmd.policy ?? DEFAULT_IDENTITY_POLICY;
  // Invalidate every prior code for this user.
  const existing = await listRecoveryCodesForUser(entities, cmd.tenantId, cmd.userId);
  const occurredAt = new Date().toISOString();
  for (const c of existing) {
    if (c.status === 'active') {
      await putRecoveryCodeEntity(entities, {
        ...c,
        status: 'invalidated',
        invalidatedAt: occurredAt,
      });
    }
  }
  return mintBatch(cmd, eventStore, entities, policy.recoveryCodeCount, true);
}

async function mintBatch(
  cmd: GenerateRecoveryCodesCommand,
  eventStore: EventStore,
  entities: EntityStore,
  count: number,
  isRegen: boolean,
): Promise<GenerateRecoveryCodesResult> {
  const occurredAt = new Date().toISOString();
  const batchId = newRecoveryBatchId();
  const plaintextCodes: string[] = [];
  const documents: RecoveryCodeDocument[] = [];
  for (let i = 0; i < count; i += 1) {
    const plaintext = generateSecret().slice(0, 16); // 16-char readable secret
    plaintextCodes.push(plaintext);
    // Recovery codes are 16-char base64url-shaped (~96 bits entropy).
    // SHA-256 is the right hash here — Argon2id buys nothing for
    // high-entropy secrets and pays a 250ms-per-code cost we don't
    // need to absorb. Same pattern as InviteToken / OAuth tokens.
    const doc: RecoveryCodeDocument = {
      codeId: newRecoveryCodeId(),
      tenantId: cmd.tenantId,
      userId: cmd.userId,
      codeHash: hashSecret(plaintext),
      codeLookup: lookupOf(plaintext),
      batchId,
      status: 'active',
      createdAt: occurredAt,
    };
    documents.push(doc);
    // Eager-write the entity — the dispatcher will also process the
    // batch event but the per-code rows are needed for the
    // RecoveryCodeConsumed lookup later.
    await putRecoveryCodeEntity(entities, doc);
  }
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: isRegen
      ? 'Identity.RecoveryCodesRegenerated'
      : 'Identity.RecoveryCodesGenerated',
    schemaId: isRegen
      ? 'domain.identity.recovery_codes.regenerated.v1'
      : 'domain.identity.recovery_codes.generated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.recovery.${isRegen ? 'regen' : 'gen'}.${cmd.userId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.userId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `User:${cmd.userId}`],
    retentionTag: 'retention:1y',
    payload: {
      batchId,
      codeIds: documents.map((d) => d.codeId),
      count,
    },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, documents, plaintextCodes };
}

// =====================================================================
// Redeem.
// =====================================================================

export interface RedeemRecoveryCodeCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  userId: string;
  presentedCode: string;
}

export interface RedeemRecoveryCodeResult {
  envelope: EventEnvelope;
  document: RecoveryCodeDocument;
  /** Codes remaining for this user after redemption. */
  remaining: number;
}

export async function handleRedeemRecoveryCode(
  cmd: RedeemRecoveryCodeCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<RedeemRecoveryCodeResult> {
  const candidates = await findRecoveryCodesByLookup(
    entities,
    cmd.tenantId,
    cmd.userId,
    lookupOf(cmd.presentedCode),
  );
  let matched: RecoveryCodeDocument | null = null;
  const presentedHash = hashSecret(cmd.presentedCode);
  for (const c of candidates) {
    if (c.status !== 'active') continue;
    if (constantTimeEqual(c.codeHash, presentedHash)) {
      matched = c;
      break;
    }
  }
  if (!matched) {
    throw new IdentityError(
      codes.RECOVERY_CODE_INVALID,
      'recovery code not found or already consumed',
      401,
    );
  }
  const occurredAt = new Date().toISOString();
  const consumed: RecoveryCodeDocument = {
    ...matched,
    status: 'consumed',
    consumedAt: occurredAt,
  };
  await putRecoveryCodeEntity(entities, consumed);
  const all = await listRecoveryCodesForUser(entities, cmd.tenantId, cmd.userId);
  const remaining = all.filter((c) => c.status === 'active').length;
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.RecoveryCodeConsumed',
    schemaId: 'domain.identity.recovery_code.consumed.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.recovery.consume.${matched.codeId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${cmd.userId}`,
      `RecoveryCode:${matched.codeId}`,
    ],
    retentionTag: 'retention:1y',
    payload: { document: consumed, remaining, method: 'recovery_code' },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document: consumed, remaining };
}
