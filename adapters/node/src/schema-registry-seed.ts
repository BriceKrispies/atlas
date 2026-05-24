/**
 * Idempotent first-boot seed of the control-plane schema/action registry from
 * the bundled `@atlas/schemas` set.
 *
 * Iterates `bundledSchemaSeed()` + `bundledActionSeed()` and inserts each row
 * with `source='seed'` via `INSERT ... ON CONFLICT DO NOTHING`. Re-running is a
 * no-op once rows exist; a `source='registered'` row written at runtime is
 * never overwritten by a later boot's seed (the bundle is the seed, not the
 * live source). The registry-version cursor is bumped once if anything was
 * inserted, so a freshly-constructed registry observes the seeded rows.
 *
 * Expects the control-plane migrations (incl. `00000005_schema_registry.sql`)
 * to have already been applied; it does not create the tables.
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#seed-from-bundle-on-boot-idempotent
 */
import { bundledSchemaSeed, bundledActionSeed } from '@atlas/schemas';
import type postgres from 'postgres';

export async function seedControlPlaneSchemaRegistry(sql: postgres.Sql): Promise<void> {
  let inserted = 0;

  for (const row of bundledSchemaSeed()) {
    const result = await sql`
      INSERT INTO control_plane.intent_schemas
        (schema_id, schema_version, document, source)
      VALUES (${row.schemaId}, ${row.schemaVersion},
              ${sql.json(row.document as Record<string, never>)}, 'seed')
      ON CONFLICT (schema_id, schema_version) DO NOTHING
    `;
    inserted += result.count;
  }

  for (const entry of bundledActionSeed()) {
    const result = await sql`
      INSERT INTO control_plane.action_entries
        (action_id, resource_type, schema_id, schema_version, module_id, source)
      VALUES (${entry.actionId}, ${entry.resourceType}, ${entry.schemaId},
              ${entry.schemaVersion}, ${entry.moduleId ?? null}, 'seed')
      ON CONFLICT (action_id) DO NOTHING
    `;
    inserted += result.count;
  }

  // Bump the cursor once if the seed actually wrote anything, so a registry
  // constructed before/after the seed refreshes its snapshot. Re-seeds that
  // insert nothing leave the cursor untouched (a true no-op).
  if (inserted > 0) {
    await sql`UPDATE control_plane.registry_version SET version = version + 1`;
  }
}
