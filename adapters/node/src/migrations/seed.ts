/**
 * Control-plane seed runner — TypeScript port of
 * `crates/control_plane_db/src/bin/seed.rs`.
 *
 * Mirrors the Rust seed binary's inserts so a Node-side ingress can run
 * with the same fixtures the Rust integration tests assume:
 *
 *  - one sample tenant: `tenant-itest-001`
 *  - the `content-pages` demo module (always)
 *  - the `structured-catalog` module (when its manifest is present)
 *  - schema registry entries for `event_envelope`, `module_manifest`,
 *    `policy_ast`, `cache_policy`
 *  - a baseline allow-all policy bundle for the sample tenant
 *
 * The Rust binary discovers fixtures via env vars with hard-coded
 * relative-path defaults (`../../specs/...`) that only resolve from
 * the crate dir. We do the same in spirit but resolve relative to the
 * repo root computed from this file's location, so the function works
 * regardless of where it's invoked from. Override with `ATLAS_FIXTURES_DIR`,
 * `ATLAS_MODULES_DIR`, `ATLAS_SCHEMAS_DIR` (same names as the Rust binary).
 *
 * Idempotent: every INSERT uses `ON CONFLICT ... DO NOTHING` (or
 * `DO UPDATE` for a couple of fields the Rust seed deliberately
 * refreshes — `modules.latest_version` and
 * `tenant_modules.enabled_version`).
 *
 * Invocation:
 *   - From a Node script: `runControlPlaneSeed(sql)` after migrations.
 *   - From the Makefile: `make db-seed` still calls the Rust binary; if
 *     a TS-only path is needed, wire a `tsx` entrypoint into a new make
 *     target rather than replacing the existing one.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';
import { seedContentPagesEntityTypes } from '@atlas/content-pages';
import { seedIdentityEntityTypes } from '@atlas/identity';

const HERE = dirname(fileURLToPath(import.meta.url));
// adapters/node/src/migrations/ -> repo root is four levels up.
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

const SAMPLE_TENANT_ID = 'tenant-itest-001';

export interface SeedResult {
  tenant: string;
  modules: string[];
  schemas: string[];
  policyVersion: number;
}

interface ManifestSpec {
  label: string;
  path: string;
}

interface JsonObject {
  [k: string]: unknown;
}

function md5Hex(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function asString(v: unknown, ctx: string): string {
  if (typeof v !== 'string') throw new Error(`expected string for ${ctx}`);
  return v;
}

/**
 * Idempotently insert the canonical control-plane seed data.
 *
 * The function expects `runMigrations(sql, 'control-plane')` to have
 * already been called — it does not create the schema itself.
 */
export async function runControlPlaneSeed(
  sql: postgres.Sql,
): Promise<SeedResult> {
  // 1. Sample tenant.
  await sql`
    INSERT INTO control_plane.tenants (tenant_id, name, status, region)
    VALUES (${SAMPLE_TENANT_ID}, 'Sample Tenant', 'active', 'us-west')
    ON CONFLICT (tenant_id) DO NOTHING
  `;

  // 2. Module manifests.
  const fixturesDir =
    process.env['ATLAS_FIXTURES_DIR'] ?? join(REPO_ROOT, 'specs', 'fixtures');
  const modulesDir =
    process.env['ATLAS_MODULES_DIR'] ?? join(REPO_ROOT, 'specs', 'modules');

  const manifestSpecs: ManifestSpec[] = [
    {
      label: 'content-pages',
      path: join(fixturesDir, 'module_manifest__valid__content_pages.json'),
    },
  ];
  const catalogPath = join(modulesDir, 'structured-catalog', 'module.manifest.json');
  if (existsSync(catalogPath)) {
    manifestSpecs.push({ label: 'structured-catalog', path: catalogPath });
  }

  const insertedModules: string[] = [];

  for (const spec of manifestSpecs) {
    const manifestContent = await readFile(spec.path, 'utf8');
    const parsed: unknown = JSON.parse(manifestContent);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`manifest ${spec.label} is not a JSON object`);
    }
    // Strip JSON Schema annotation keys ($schema, $id, ...) — matches
    // the Rust seed's `obj.retain(|k, _| !k.starts_with('$'))`.
    const manifest: JsonObject = {};
    for (const [k, v] of Object.entries(parsed as JsonObject)) {
      if (!k.startsWith('$')) manifest[k] = v;
    }

    const moduleId = asString(manifest['moduleId'], `moduleId in ${spec.label}`);
    const version = asString(manifest['version'], `version in ${spec.label}`);
    const displayName = asString(
      manifest['displayName'],
      `displayName in ${spec.label}`,
    );
    // Rust hashes the *original* file content (before stripping `$`-keys).
    // Reproduce that exactly so the schema_hash matches across runtimes.
    const schemaHash = md5Hex(manifestContent);

    await sql`
      INSERT INTO control_plane.modules (module_id, display_name, latest_version)
      VALUES (${moduleId}, ${displayName}, ${version})
      ON CONFLICT (module_id) DO UPDATE SET
        latest_version = EXCLUDED.latest_version
    `;

    await sql`
      INSERT INTO control_plane.module_versions (module_id, version, manifest_json, schema_hash)
      VALUES (${moduleId}, ${version}, ${sql.json(manifest as never)}, ${schemaHash})
      ON CONFLICT (module_id, version) DO NOTHING
    `;

    await sql`
      INSERT INTO control_plane.tenant_modules (tenant_id, module_id, enabled_version)
      VALUES (${SAMPLE_TENANT_ID}, ${moduleId}, ${version})
      ON CONFLICT (tenant_id, module_id) DO UPDATE SET
        enabled_version = EXCLUDED.enabled_version
    `;

    insertedModules.push(moduleId);
  }

  // 3. Schema registry entries.
  const schemasDir =
    process.env['ATLAS_SCHEMAS_DIR'] ??
    join(REPO_ROOT, 'specs', 'schemas', 'contracts');
  const schemaSpecs: { id: string; path: string }[] = [
    { id: 'event_envelope', path: join(schemasDir, 'event_envelope.schema.json') },
    { id: 'module_manifest', path: join(schemasDir, 'module_manifest.schema.json') },
    { id: 'policy_ast', path: join(schemasDir, 'policy_ast.schema.json') },
    { id: 'cache_policy', path: join(schemasDir, 'cache_policy.schema.json') },
  ];
  const insertedSchemas: string[] = [];
  for (const { id, path } of schemaSpecs) {
    if (!existsSync(path)) continue;
    const content = await readFile(path, 'utf8');
    const schema: unknown = JSON.parse(content);
    await sql`
      INSERT INTO control_plane.schema_registry (schema_id, version, json_schema, compat_mode)
      VALUES (${id}, 1, ${sql.json(schema as never)}, 'BACKWARD')
      ON CONFLICT (schema_id, version) DO NOTHING
    `;
    insertedSchemas.push(id);
  }

  // 4. Baseline allow-all policy bundle for the sample tenant.
  const policyBundle = {
    policies: [
      {
        policyId: 'allow-all-admin',
        tenantId: SAMPLE_TENANT_ID,
        rules: [
          {
            ruleId: 'admin-allow-all',
            effect: 'allow',
            conditions: { type: 'literal', value: true },
          },
        ],
        version: 1,
        status: 'active',
      },
    ],
  };
  await sql`
    INSERT INTO control_plane.policies (tenant_id, version, policy_json, status)
    VALUES (${SAMPLE_TENANT_ID}, 1, ${sql.json(policyBundle as never)}, 'active')
    ON CONFLICT (tenant_id, version) DO NOTHING
  `;

  // 5. Platform-default L3 entity-type registry rows for built-in modules.
  //    Each module exposes a `seed*EntityTypes` function that idempotently
  //    inserts into entity_type_registry / field_registry / index_registry.
  //    Phase B.1: content-pages.
  await seedContentPagesEntityTypes(sql);
  //    Phase A1: identity (User, Membership, InviteToken).
  await seedIdentityEntityTypes(sql);

  return {
    tenant: SAMPLE_TENANT_ID,
    modules: insertedModules,
    schemas: insertedSchemas,
    policyVersion: 1,
  };
}
