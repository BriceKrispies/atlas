import { badgeFamilySeed } from '@atlas/schemas';
import type { IntentEnvelope } from '@atlas/platform-core';
import { newEventId } from '@atlas/modules-catalog';

export interface BadgeFamilySeedDoc {
  packageKey: string;
  version: string;
  payload: unknown;
}

export function loadBadgeFamilySeed(): BadgeFamilySeedDoc {
  return badgeFamilySeed() as BadgeFamilySeedDoc;
}

export function buildSeedIntent(
  tenantId: string,
  principalId: string,
  idemKey: string,
  seed: BadgeFamilySeedDoc,
): IntentEnvelope {
  return {
    eventId: newEventId(),
    eventType: 'Catalog.SeedPackage.ApplyRequested',
    schemaId: 'catalog.seed_package.apply.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId,
    correlationId: newEventId(),
    idempotencyKey: idemKey,
    principalId,
    userId: principalId,
    payload: {
      actionId: 'Catalog.SeedPackage.Apply',
      resourceType: 'SeedPackage',
      resourceId: null,
      seedPackageKey: seed.packageKey,
      seedPackageVersion: seed.version,
      payload: seed.payload,
    },
  };
}
