import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { SamlSpKeyDocument } from '../types.ts';
import { newEventId, newSamlSpKeyId } from '../ids.ts';
import {
  encryptionKeyIdForTenant,
  encryptSecret,
} from '../crypto/totp.ts';
import { generateSamlSpKey } from '../saml/sp-key.ts';
import {
  findActiveSamlSpKey,
  getSamlSpKeyEntity,
} from '../entities/saml-sp-key.ts';

const DEFAULT_ROTATION_OVERLAP_HOURS = 7 * 24; // 7 days for SAML — IdPs cache metadata

export interface SamlSpKeyGenerateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  /** Subject common-name. Defaults to the SP entityId pattern. */
  commonName?: string;
  validDays?: number;
  keyLength?: 2048 | 3072 | 4096;
}

export interface SamlSpKeyGenerateResult {
  envelope: EventEnvelope;
  document: SamlSpKeyDocument;
}

export async function handleSamlSpKeyGenerate(
  cmd: SamlSpKeyGenerateCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<SamlSpKeyGenerateResult> {
  // Refuse if there's already an active key — caller should rotate
  // explicitly so the audit trail distinguishes "first key" from
  // "lost the old one".
  const existing = await findActiveSamlSpKey(entities, cmd.tenantId);
  if (existing) {
    throw new IdentityError(
      codes.IDENTITY_INVALID,
      `tenant ${cmd.tenantId} already has an active SP key (${existing.keyId}); use Rotate instead`,
      409,
    );
  }
  return mintKey(cmd, eventStore, entities);
}

export interface SamlSpKeyRotateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  /** The key to rotate from. */
  keyId: string;
  overlapHours?: number;
  commonName?: string;
  validDays?: number;
  keyLength?: 2048 | 3072 | 4096;
}

export interface SamlSpKeyRotateResult {
  envelope: EventEnvelope;
  predecessor: SamlSpKeyDocument;
  successor: SamlSpKeyDocument;
  follow: ReadonlyArray<EventEnvelope>;
}

export async function handleSamlSpKeyRotate(
  cmd: SamlSpKeyRotateCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<SamlSpKeyRotateResult> {
  const predecessor = await getSamlSpKeyEntity(entities, cmd.tenantId, cmd.keyId);
  if (!predecessor) {
    throw new IdentityError(
      codes.SAML_SP_KEY_NOT_FOUND,
      `saml SP key not found: ${cmd.keyId}`,
      404,
    );
  }
  if (predecessor.status !== 'active') {
    throw new IdentityError(
      codes.IDENTITY_INVALID,
      `key ${cmd.keyId} is in status ${predecessor.status}`,
      409,
    );
  }
  const occurredAt = new Date().toISOString();
  const overlapHours = cmd.overlapHours ?? DEFAULT_ROTATION_OVERLAP_HOURS;
  const overlapUntil = new Date(
    Date.now() + overlapHours * 60 * 60 * 1000,
  ).toISOString();
  // Mint successor.
  const succ = await mintKey(
    {
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      principalId: cmd.principalId,
      ...(cmd.commonName !== undefined ? { commonName: cmd.commonName } : {}),
      ...(cmd.validDays !== undefined ? { validDays: cmd.validDays } : {}),
      ...(cmd.keyLength !== undefined ? { keyLength: cmd.keyLength } : {}),
    },
    eventStore,
    entities,
    { rotatedFromKeyId: cmd.keyId },
  );
  // Flip predecessor to rotated.
  const flippedPredecessor: SamlSpKeyDocument = {
    ...predecessor,
    status: 'rotated',
    rotatedToKeyId: succ.document.keyId,
    rotationOverlapUntil: overlapUntil,
    endedAt: occurredAt,
  };
  const predEvent: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.SamlSpKeyRotated',
    schemaId: 'domain.identity.saml.sp_key_rotated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.saml.sp-key.rotate.${cmd.keyId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `SamlSpKey:${cmd.keyId}`],
    retentionTag: 'retention:1y',
    payload: { document: flippedPredecessor },
  };
  const stored = await eventStore.append(predEvent);
  predEvent.eventId = stored.eventId;
  predEvent.seq = stored.seq;
  return {
    envelope: predEvent,
    follow: [succ.envelope],
    predecessor: flippedPredecessor,
    successor: succ.document,
  };
}

async function mintKey(
  cmd: {
    tenantId: string;
    correlationId: string;
    principalId: string | null;
    commonName?: string;
    validDays?: number;
    keyLength?: 2048 | 3072 | 4096;
  },
  eventStore: EventStore,
  entities: EntityStore,
  rotationContext: { rotatedFromKeyId?: string } = {},
): Promise<SamlSpKeyGenerateResult> {
  const occurredAt = new Date().toISOString();
  const keyId = newSamlSpKeyId();
  const cn = cmd.commonName ?? `atlas-sp:${cmd.tenantId}`;
  const generated = generateSamlSpKey({
    commonName: cn,
    ...(cmd.validDays !== undefined ? { validDays: cmd.validDays } : {}),
    ...(cmd.keyLength !== undefined ? { keyLength: cmd.keyLength } : {}),
  });
  const encryptedPrivateKey = encryptSecret(
    Buffer.from(generated.privateKeyPem, 'utf8'),
    cmd.tenantId,
  );
  const document: SamlSpKeyDocument = {
    keyId,
    tenantId: cmd.tenantId,
    encryptedPrivateKey,
    encryptionKeyId: encryptionKeyIdForTenant(cmd.tenantId),
    publicCertPem: generated.publicCertPem,
    keyLength: generated.keyLength,
    status: 'active',
    issuedAt: occurredAt,
    expiresAt: generated.notAfter,
    ...(rotationContext.rotatedFromKeyId !== undefined
      ? { rotatedFromKeyId: rotationContext.rotatedFromKeyId }
      : {}),
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.SamlSpKeyGenerated',
    schemaId: 'domain.identity.saml.sp_key_generated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.saml.sp-key.generate.${keyId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `SamlSpKey:${keyId}`],
    retentionTag: 'retention:1y',
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}
