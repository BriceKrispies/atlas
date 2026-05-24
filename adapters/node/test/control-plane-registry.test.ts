import {
  controlPlaneRegistryContract,
  controlPlaneRegistryDynamicContract,
  type DynamicRegistryHarness,
  type SchemaRegistryDoc,
} from '@atlas/contract-tests';
import { describe, test, expect, beforeAll } from '@atlas/test';
import postgres from 'postgres';
import type { ActionEntry } from '@atlas/ports';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { PostgresControlPlaneRegistry, runMigrations } from '../src/index.ts';
import { TEST_DB_URL, HAS_DB } from './_setup.ts';

// The static (bundled-manifest) contract suite is read-only over @atlas/schemas
// and needs no Postgres connection — it always runs (matching IDB).
// @spec: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#surfaces
controlPlaneRegistryContract(async function () {
  return new PostgresControlPlaneRegistry();
});

// ── Dynamic-registration + seed-idempotency contract (control-plane backed) ──
//
// These exercise the registry-as-data path: a row written to
// control_plane.intent_schemas / control_plane.action_entries becomes
// resolvable through the sync port on the next lookup, same process. They
// require a real Postgres (migration 00000005_schema_registry) and so are
// skipped silently when TEST_TENANT_DB_URL is unset.
//
// @spec: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#acceptance
if (HAS_DB) {
  controlPlaneRegistryDynamicContract(async function (): Promise<DynamicRegistryHarness> {
    // `prepare: false` is a deliberate test-pool setting: the dynamic contract
    // creates/drops registry rows across reconnecting pools, so prepared-
    // statement caching across short-lived pools is more trouble than it's
    // worth here. Production uses prepared statements; this is test-only.
    const sql = postgres(
      assertDefined(TEST_DB_URL, 'HAS_DB guard ensures TEST_DB_URL is set'),
      { max: 2, prepare: false },
    );
    await runMigrations(sql, 'control-plane');
    // Fresh slate for the registry tables this contract drives. Once
    // migration 00000005 lands these tables exist; until then the DELETEs
    // (and every subsequent write) fail with "relation does not exist" —
    // the intended behavior-gap failure for Phase 1.0.
    await sql.unsafe(`DELETE FROM control_plane.intent_schemas`);
    await sql.unsafe(`DELETE FROM control_plane.action_entries`);

    const registry = new PostgresControlPlaneRegistry(sql);

    return {
      registry,
      async registerSchema(doc: SchemaRegistryDoc): Promise<void> {
        await sql`
          INSERT INTO control_plane.intent_schemas
            (schema_id, schema_version, document, source)
          VALUES (${doc.schemaId}, ${doc.schemaVersion}, ${sql.json(doc.document as Record<string, never>)},
                  ${doc.source ?? 'registered'})
          ON CONFLICT (schema_id, schema_version) DO UPDATE
            SET document = EXCLUDED.document
        `;
        // Bump the version cursor so the registry snapshot refreshes.
        await sql`UPDATE control_plane.registry_version SET version = version + 1`;
      },
      async registerAction(entry: ActionEntry & { source?: 'seed' | 'registered' }): Promise<void> {
        await sql`
          INSERT INTO control_plane.action_entries
            (action_id, resource_type, schema_id, schema_version, source)
          VALUES (${entry.actionId}, ${entry.resourceType}, ${entry.schemaId},
                  ${entry.schemaVersion}, ${entry.source ?? 'registered'})
          ON CONFLICT (action_id) DO NOTHING
        `;
        await sql`UPDATE control_plane.registry_version SET version = version + 1`;
      },
      async reseed(): Promise<void> {
        // The bundled @atlas/schemas seed: idempotent INSERT ... ON CONFLICT
        // DO NOTHING with source='seed'. This is the production seeder the
        // capability adds; until it exists the registry rows are never
        // populated and seed-idempotency assertions fail at readSource.
        const { seedControlPlaneSchemaRegistry } = await import('../src/index.ts');
        await seedControlPlaneSchemaRegistry(sql);
      },
      async readSource(schemaId, schemaVersion) {
        const rows = await sql<{ source: 'seed' | 'registered' }[]>`
          SELECT source FROM control_plane.intent_schemas
          WHERE schema_id = ${schemaId} AND schema_version = ${schemaVersion}
        `;
        return rows[0]?.source ?? null;
      },
      // Models a new request arriving at the boundary (decision O1,
      // refresh-at-request-boundary): the production server's
      // `registryRefreshMiddleware` awaits `registry.refresh()` before the
      // intents routes run. After this, the sync port lookups observe the
      // row written above (N+1, same process).
      refreshBoundary: async () => {
        await registry.refresh();
      },
      // Close the factory-acquired pool so the suite does not leak
      // connections / exhaust max_connections across cases (the architect's
      // pool-leak fix).
      teardown: async () => {
        await sql.end({ timeout: 5 });
      },
    };
  });
} else {
  describe('ControlPlaneRegistry dynamic-registration (skipped: TEST_TENANT_DB_URL not set)', function () {
    // intentionally empty — env-gated suite
    test('skipped', function () {
      expect(true).toBe(true);
    });
  });
}
