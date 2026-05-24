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
import { buildRolePackBundle } from '@atlas/identity';
import { moduleManifests } from '@atlas/schemas';
import type { ActionDeclaration } from '@atlas/platform-core';
import { seedContentPagesEntityTypes } from '../seeds/content-pages-types.ts';
import { seedIdentityEntityTypes } from '../seeds/identity-types.ts';
import { jsonParam } from '../seeds/sql-json.ts';
import { seedControlPlaneSchemaRegistry } from '../schema-registry-seed.ts';

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

/**
 * Type guard for plain JSON objects (non-null, non-array). Narrows
 * `unknown` to `Record<string, unknown>` so property reads on
 * `moduleManifests()` results stay inside the type system instead of
 * forcing per-property `as { foo?: unknown }` casts.
 */
function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pull every `ActionDeclaration` declared across the bundled module
 * manifests. Used to drive the role-pack Cedar generation. Defensive
 * shape coercion — `moduleManifests()` returns `unknown[]` so we
 * structurally pick what we need. Missing `verb` defaults to empty
 * (treated as a read by the role-pack builder); missing `auditLevel`
 * defaults to `INFO` (the role-pack builder ignores this field).
 */
function collectManifestActions(
  manifests: ReadonlyArray<unknown>,
): ActionDeclaration[] {
  const out: ActionDeclaration[] = [];
  for (const m of manifests) {
    if (!isJsonObject(m)) continue;
    const actions = m['actions'];
    if (!Array.isArray(actions)) continue;
    for (const a of actions) {
      if (!isJsonObject(a)) continue;
      const aid = a['actionId'];
      const rt = a['resourceType'];
      if (typeof aid !== 'string' || typeof rt !== 'string') continue;
      const rawVerb = a['verb'];
      const rawAuditLevel = a['auditLevel'];
      out.push({
        actionId: aid,
        resourceType: rt,
        verb: typeof rawVerb === 'string' ? rawVerb : '',
        auditLevel:
          rawAuditLevel === 'NONE' ||
          rawAuditLevel === 'BASIC' ||
          rawAuditLevel === 'SENSITIVE' ||
          rawAuditLevel === 'FULL_PAYLOAD'
            ? rawAuditLevel
            : 'INFO',
      });
    }
  }
  return out;
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
    if (!isJsonObject(parsed)) {
      throw new Error(`manifest ${spec.label} is not a JSON object`);
    }
    // Strip JSON Schema annotation keys ($schema, $id, ...) — matches
    // the Rust seed's `obj.retain(|k, _| !k.starts_with('$'))`.
    const manifest: JsonObject = {};
    for (const [k, v] of Object.entries(parsed)) {
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
      VALUES (${moduleId}, ${version}, ${jsonParam(sql, manifest)}, ${schemaHash})
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
      VALUES (${id}, 1, ${jsonParam(sql, schema)}, 'BACKWARD')
      ON CONFLICT (schema_id, version) DO NOTHING
    `;
    insertedSchemas.push(id);
  }

  // 4. Platform-default role packs for the sample tenant.
  //    Phase A1 (#44): replaces the legacy allow-all-admin stub bundle
  //    with TenantAdmin/Author/Viewer/ServicePrincipal cedar permits
  //    generated from the bundled module manifests' verbs. The
  //    StubPolicyEngine doesn't read this row (it's allow-all by
  //    construction); the CedarPolicyEngine does, and a wrong-format
  //    row would hard-fail every request — so the wrapper is now
  //    `format='cedar-text'`.
  //
  //    `ON CONFLICT DO NOTHING` keeps the seed idempotent. To re-run
  //    after a policy schema change, bump the version manually or use
  //    the activation flow (`Authz.Policy.Activate`).
  const allActions = collectManifestActions(moduleManifests());
  const policyBundle = buildRolePackBundle(allActions);
  await sql`
    INSERT INTO control_plane.policies (tenant_id, version, policy_json, status)
    VALUES (${SAMPLE_TENANT_ID}, 1, ${jsonParam(sql, policyBundle)}, 'active')
    ON CONFLICT (tenant_id, version) DO NOTHING
  `;

  // 5. Platform-default L3 entity-type registry rows for built-in modules.
  //    Each module exposes a `seed*EntityTypes` function that idempotently
  //    inserts into entity_type_registry / field_registry / index_registry.
  //    Phase B.1: content-pages.
  await seedContentPagesEntityTypes(sql);
  //    Phase A1: identity (User, Membership, InviteToken).
  await seedIdentityEntityTypes(sql);

  // 6. Control-plane schema & action registry (registry-as-data). Seeds the
  //    bundled @atlas/schemas intent schemas + action catalog into
  //    control_plane.intent_schemas / action_entries (idempotent, source='seed').
  //    Thereafter those tables are the live source PostgresControlPlaneRegistry
  //    reads (capability control-plane-schema-registry, I20).
  await seedControlPlaneSchemaRegistry(sql);

  return {
    tenant: SAMPLE_TENANT_ID,
    modules: insertedModules,
    schemas: insertedSchemas,
    policyVersion: 1,
  };
}
