import type { Db } from '../../../ports/db.ts';
import type { EventStorePort } from '../../../ports/event-store.ts';
import type { EventEnvelope } from '../../../types.ts';
import type { SeedPayload } from '../seed-types.ts';
import { deterministicUuid, newEventId } from '../ids.ts';

// Divergence: the Rust handler normalizes the seed into many catalog_* tables.
// In the simulator we keep the parsed seed as a single snapshot keyed by tenantId.

export interface SeedPackageApplyCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  seedPackageKey: string;
  seedPackageVersion: string;
  payload: SeedPayload;
}

export interface SeedSummary {
  taxonomyTreeCount: number;
  taxonomyNodeCount: number;
  familyCount: number;
  variantCount: number;
  attributeDefinitionCount: number;
  assetCount: number;
}

export interface SeedPackageApplyResult {
  envelope: EventEnvelope;
  summary: SeedSummary;
  familyIds: string[];
  taxonomyTreeKeys: string[];
}

export async function handleSeedPackageApply(
  cmd: SeedPackageApplyCommand,
  db: Db,
  eventStore: EventStorePort,
): Promise<SeedPackageApplyResult> {
  const taxonomyNodeCount = cmd.payload.taxonomyTrees.reduce(
    (acc, t) => acc + t.nodes.length,
    0,
  );
  const variantCount = cmd.payload.families.reduce((acc, f) => acc + f.variants.length, 0);
  const summary: SeedSummary = {
    taxonomyTreeCount: cmd.payload.taxonomyTrees.length,
    taxonomyNodeCount,
    familyCount: cmd.payload.families.length,
    variantCount,
    attributeDefinitionCount: cmd.payload.attributeDefinitions?.length ?? 0,
    assetCount: cmd.payload.assets?.length ?? 0,
  };

  const familyIds = cmd.payload.families.map((f) =>
    deterministicUuid('family', cmd.tenantId, f.key),
  );
  const taxonomyTreeKeys = cmd.payload.taxonomyTrees.map((t) => t.key);

  const existing = await db.get('catalog_state', cmd.tenantId);
  const publishedRevisions: Record<string, number> = existing?.publishedRevisions ?? {};
  await db.put('catalog_state', {
    tenantId: cmd.tenantId,
    seedPackageKey: cmd.seedPackageKey,
    seedPackageVersion: cmd.seedPackageVersion,
    payload: cmd.payload,
    publishedRevisions,
  });

  const tags: string[] = [`Tenant:${cmd.tenantId}`];
  for (const tk of taxonomyTreeKeys) tags.push(`TaxonomyTree:${tk}`);
  for (const fid of familyIds) tags.push(`Family:${fid}`);
  tags.push('SearchIndex:catalog');

  const idempotencyKey = `catalog.seed.${cmd.tenantId}.${cmd.seedPackageKey}.${cmd.seedPackageVersion}`;
  const occurredAt = new Date().toISOString();
  const eventId = newEventId();

  const envelope: EventEnvelope = {
    eventId,
    eventType: 'StructuredCatalog.SeedPackageApplied',
    schemaId: 'catalog.seed_package_applied.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: tags,
    payload: {
      seedPackageKey: cmd.seedPackageKey,
      seedPackageVersion: cmd.seedPackageVersion,
      appliedAt: occurredAt,
      summary: summary,
    },
  };

  const storedEventId = await eventStore.append(envelope);
  envelope.eventId = storedEventId;

  return { envelope, summary, familyIds, taxonomyTreeKeys };
}
