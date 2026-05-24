/**
 * In-memory mirror of the idempotent first-boot schema/action registry seed.
 *
 * Mirrors the Postgres seeder (`@atlas/adapter-node`
 * `seedControlPlaneSchemaRegistry`): iterate the bundled `@atlas/schemas` set
 * and populate the in-memory store with `source='seed'` rows. Re-running is a
 * no-op for rows already present, and a `source='registered'` row is never
 * overwritten — the bundle is the seed, not the live source.
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#seed-from-bundle-on-boot-idempotent
 */
import { bundledSchemaSeed, bundledActionSeed } from '@atlas/schemas';
import type { InMemorySchemaRegistryStore } from './control-plane-registry.ts';

function schemaKey(schemaId: string, schemaVersion: number): string {
  return `${schemaId}:${schemaVersion}`;
}

export async function seedInMemorySchemaRegistry(
  store: InMemorySchemaRegistryStore,
): Promise<void> {
  let mutated = false;

  for (const row of bundledSchemaSeed()) {
    const key = schemaKey(row.schemaId, row.schemaVersion);
    // INSERT ... ON CONFLICT DO NOTHING — never clobber an existing row
    // (especially a source='registered' one).
    if (store.schemas.has(key)) continue;
    store.schemas.set(key, {
      schemaId: row.schemaId,
      schemaVersion: row.schemaVersion,
      document: row.document,
      source: 'seed',
    });
    mutated = true;
  }

  for (const entry of bundledActionSeed()) {
    if (store.actions.has(entry.actionId)) continue;
    store.actions.set(entry.actionId, {
      actionId: entry.actionId,
      resourceType: entry.resourceType,
      schemaId: entry.schemaId,
      schemaVersion: entry.schemaVersion,
      source: 'seed',
    });
    mutated = true;
  }

  if (mutated) store.version += 1;
}
