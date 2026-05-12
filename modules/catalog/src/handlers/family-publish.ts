import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore, CatalogStateStore } from '@atlas/ports';
import { deterministicUuid, newEventId } from '../ids.ts';
import { CatalogError } from '../errors.ts';
import { readSeed } from '../internal/seed-state.ts';

export interface FamilyPublishCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  familyKey: string;
  familyRevisionNumber: number;
}

export interface FamilyPublishResult {
  familyEnvelope: EventEnvelope;
  variantEnvelopes: EventEnvelope[];
}

export async function handleFamilyPublish(
  cmd: FamilyPublishCommand,
  catalogState: CatalogStateStore,
  eventStore: EventStore,
): Promise<FamilyPublishResult> {
  const state = await catalogState.get(cmd.tenantId);
  if (!state) {
    throw new CatalogError('FAMILY_NOT_FOUND', `family not found: ${cmd.familyKey}`);
  }
  const seed = readSeed(state);
  const family = seed.families.find((f) => f.key === cmd.familyKey);
  if (!family) {
    throw new CatalogError('FAMILY_NOT_FOUND', `family not found: ${cmd.familyKey}`);
  }

  const familyId = deterministicUuid('family', cmd.tenantId, family.key);
  const publishedRevisions = { ...state.publishedRevisions };
  publishedRevisions[family.key] = cmd.familyRevisionNumber;

  await catalogState.put({
    ...state,
    publishedRevisions,
  });

  const occurredAt = new Date().toISOString();
  const familyEventId = newEventId();
  const familyEnvelope: EventEnvelope = {
    eventId: familyEventId,
    eventType: 'StructuredCatalog.FamilyPublished',
    schemaId: 'catalog.family_published.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `catalog.family.publish.${cmd.tenantId}.${family.key}.${cmd.familyRevisionNumber}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `Family:${familyId}`,
      'SearchIndex:catalog',
    ],
    payload: {
      familyKey: family.key,
      familyId,
      revisionNumber: cmd.familyRevisionNumber,
      publishedAt: occurredAt,
    },
  };
  const storedFamily = await eventStore.append(familyEnvelope);
  familyEnvelope.eventId = storedFamily.eventId;
  familyEnvelope.seq = storedFamily.seq;
  const storedFamilyId = storedFamily.eventId;

  const variantEnvelopes: EventEnvelope[] = [];
  for (const v of family.variants) {
    const variantId = deterministicUuid('variant', cmd.tenantId, family.key, v.key);
    const eventId = newEventId();
    const envelope: EventEnvelope = {
      eventId,
      eventType: 'StructuredCatalog.VariantUpserted',
      schemaId: 'catalog.variant_upserted.v1',
      schemaVersion: 1,
      occurredAt,
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      idempotencyKey: `catalog.variant.upserted.${cmd.tenantId}.${family.key}.${v.key}.${cmd.familyRevisionNumber}`,
      causationId: storedFamilyId,
      principalId: cmd.principalId,
      userId: cmd.principalId,
      cacheInvalidationTags: [
        `Tenant:${cmd.tenantId}`,
        `Family:${familyId}`,
        'SearchIndex:catalog',
      ],
      payload: {
        familyKey: family.key,
        familyId,
        variantKey: v.key,
        variantId,
        revisionNumber: cmd.familyRevisionNumber,
        attributeValuesCount: Object.keys(v.values).length,
        upsertedAt: occurredAt,
      },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    variantEnvelopes.push(envelope);
  }

  return { familyEnvelope, variantEnvelopes };
}
