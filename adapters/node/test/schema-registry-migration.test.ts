/**
 * Migration-applies scaffold for 00000005_schema_registry.
 *
 * Asserts the control-plane migration runner creates the registry tables the
 * capability needs: control_plane.intent_schemas, control_plane.action_entries,
 * and the single-row control_plane.registry_version change cursor.
 *
 * Schema is installed by the bundled `runMigrations(sql, 'control-plane')` —
 * the same code path production `apps/server` uses. Skipped silently when
 * TEST_TENANT_DB_URL is unset (matches the rest of @atlas/adapter-node).
 *
 * @spec: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#acceptance
 */
import { describe, test, expect, beforeAll, afterAll } from '@atlas/test';
import postgres from 'postgres';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { runMigrations } from '../src/index.ts';
import { TEST_DB_URL, HAS_DB } from './_setup.ts';

if (HAS_DB) {
  describe('00000005_schema_registry creates intent_schemas + action_entries', function () {
    let sql: postgres.Sql;

    beforeAll(async function () {
      sql = postgres(
        assertDefined(TEST_DB_URL, 'HAS_DB guard ensures TEST_DB_URL is set'),
        { max: 2, prepare: false },
      );
      await runMigrations(sql, 'control-plane');
    });

    // Close the pool so the suite does not leak connections / exhaust
    // max_connections — without this the process hangs after the tests
    // pass (the architect's pool-leak class).
    afterAll(async function () {
      await sql.end({ timeout: 5 });
    });

    async function tableExists(name: string): Promise<boolean> {
      const rows = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'control_plane' AND table_name = ${name}
        ) AS exists
      `;
      return rows[0]?.exists ?? false;
    }

    async function columns(name: string): Promise<string[]> {
      const rows = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'control_plane' AND table_name = ${name}
      `;
      return rows.map((r) => r.column_name);
    }

    test('control_plane.intent_schemas exists with the (schema_id, schema_version, document, source) shape', async function () {
      expect(await tableExists('intent_schemas')).toBe(true);
      const cols = await columns('intent_schemas');
      expect(cols).toContain('schema_id');
      expect(cols).toContain('schema_version');
      expect(cols).toContain('document');
      expect(cols).toContain('source');
    });

    test('control_plane.action_entries exists with the (action_id, resource_type, schema_id, schema_version, source) shape', async function () {
      expect(await tableExists('action_entries')).toBe(true);
      const cols = await columns('action_entries');
      expect(cols).toContain('action_id');
      expect(cols).toContain('resource_type');
      expect(cols).toContain('schema_id');
      expect(cols).toContain('schema_version');
      expect(cols).toContain('source');
    });

    test('control_plane.registry_version exists as the single-row change cursor', async function () {
      expect(await tableExists('registry_version')).toBe(true);
      const cols = await columns('registry_version');
      expect(cols).toContain('version');
    });
  });
} else {
  describe('00000005_schema_registry migration (skipped: TEST_TENANT_DB_URL not set)', function () {
    test('skipped', function () {
      expect(true).toBe(true);
    });
  });
}
