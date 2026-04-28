import type { Db } from '../../../ports/db.ts';
import type { EventStorePort } from '../../../ports/event-store.ts';
import type { EventEnvelope } from '../../../types.ts';
import type { SeedPayload } from '../seed-types.ts';
import { deterministicUuid, newEventId } from '../ids.ts';

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
  db: Db,
  eventStore: EventStorePort,
): Promise<FamilyPublishResult> {
  const state = await db.get('catalog_state', cmd.tenantId);
  if (!state) {
    throw Object.assign(new Error(`family not found: ${cmd.familyKey}`), {
      code: 'FAMILY_NOT_FOUND',
    });
  }
  const seed = state.payload as SeedPayload;
  const family = seed.families.find((f) => f.key === cmd.familyKey);
  if (!family) {
    throw Object.assign(new Error(`family not found: ${cmd.familyKey}`), {
      code: 'FAMILY_NOT_FOUND',
    });
  }

  const familyId = deterministicUuid('family', cmd.tenantId, family.key);
  const publishedRevisions = { ...state.publishedRevisions };
  publishedRevisions[family.key] = cmd.familyRevisionNumber;

  await db.put('catalog_state', {
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
  const storedFamilyId = await eventStore.append(familyEnvelope);
  familyEnvelope.eventId = storedFamilyId;

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
    envelope.eventId = stored;
    variantEnvelopes.push(envelope);
  }

  return { familyEnvelope, variantEnvelopes };
}
