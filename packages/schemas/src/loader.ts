import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction, AnySchemaObject } from 'ajv/dist/2020.js';

export type { ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json' with { type: 'json' };

import seedApply from './generated/catalog.seed_package.apply.v1.schema.json' with { type: 'json' };
import familyPublish from './generated/catalog.family.publish.v1.schema.json' with { type: 'json' };
import seedApplied from './generated/catalog.seed_package_applied.v1.schema.json' with { type: 'json' };
import familyPublished from './generated/catalog.family_published.v1.schema.json' with { type: 'json' };
import variantUpserted from './generated/catalog.variant_upserted.v1.schema.json' with { type: 'json' };
import policyEvaluated from './generated/platform.policy_evaluated.v1.schema.json' with { type: 'json' };
import authzPolicyCreate from './generated/authz.policy.create.v1.schema.json' with { type: 'json' };
import authzPolicyActivate from './generated/authz.policy.activate.v1.schema.json' with { type: 'json' };
import authzPolicyArchive from './generated/authz.policy.archive.v1.schema.json' with { type: 'json' };
import contentPagesPageCreate from './generated/content_pages.page.create.v1.schema.json' with { type: 'json' };
import contentPagesPageUpdate from './generated/content_pages.page.update.v1.schema.json' with { type: 'json' };
import contentPagesPageDelete from './generated/content_pages.page.delete.v1.schema.json' with { type: 'json' };
import contentPagesPageRead from './generated/content_pages.page.read.v1.schema.json' with { type: 'json' };
import seedScenario from './generated/seed.scenario.v1.schema.json' with { type: 'json' };
import seedFixture from './generated/seed.fixture.v1.schema.json' with { type: 'json' };
import seedTemplate from './generated/seed.template.v1.schema.json' with { type: 'json' };
import seedAxisDefinition from './generated/seed.axis_definition.v1.schema.json' with { type: 'json' };
import eventEnvelope from './generated/event_envelope.schema.json' with { type: 'json' };
import structuredCatalogManifest from './generated/manifests/structured-catalog.manifest.json' with { type: 'json' };
import authzManifest from './generated/manifests/authz.manifest.json' with { type: 'json' };
import contentPagesManifest from './generated/manifests/content-pages.manifest.json' with { type: 'json' };
import badgeFamilySeedRaw from './generated/badge-family.json' with { type: 'json' };

const SCHEMAS: ReadonlyArray<AnySchemaObject> = [
  seedApply as AnySchemaObject,
  familyPublish as AnySchemaObject,
  seedApplied as AnySchemaObject,
  familyPublished as AnySchemaObject,
  variantUpserted as AnySchemaObject,
  policyEvaluated as AnySchemaObject,
  authzPolicyCreate as AnySchemaObject,
  authzPolicyActivate as AnySchemaObject,
  authzPolicyArchive as AnySchemaObject,
  contentPagesPageCreate as AnySchemaObject,
  contentPagesPageUpdate as AnySchemaObject,
  contentPagesPageDelete as AnySchemaObject,
  contentPagesPageRead as AnySchemaObject,
  seedScenario as AnySchemaObject,
  seedFixture as AnySchemaObject,
  seedTemplate as AnySchemaObject,
  seedAxisDefinition as AnySchemaObject,
];

let cachedAjv: Ajv2020 | null = null;

function getAjv(): Ajv2020 {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  // The seeder schemas (seed.scenario.v1, seed.fixture.v1, seed.template.v1,
  // seed.axis_definition.v1) declare $schema=draft-07. AJV2020 doesn't load
  // the draft-07 meta-schema by default — registering it here lets those
  // schemas validate without rewriting them to draft 2020-12.
  ajv.addMetaSchema(draft7MetaSchema as AnySchemaObject);
  ajv.addSchema(eventEnvelope as AnySchemaObject);
  for (const s of SCHEMAS) {
    ajv.addSchema(s);
  }
  cachedAjv = ajv;
  return ajv;
}

export function getSchemaValidator(schemaId: string, _version: number): ValidateFunction | null {
  const ajv = getAjv();
  const v = ajv.getSchema(schemaId);
  return (v as ValidateFunction | undefined) ?? null;
}

/**
 * Subset of the manifest shape consumers care about. Generated manifest
 * JSON carries more fields (`manifestVersion`, `displayName`, `verb`,
 * `auditLevel`, `moduleType`, `capabilities`, `events`, `projections`,
 * `migrations`); we narrow to the fields the action catalog + Cedar
 * schema generator actually read. Keep in sync with
 * `adapters/policy-cedar/src/schema-generator.ts:ModuleManifest`.
 */
export interface ManifestAction {
  actionId: string;
  resourceType: string;
}

export interface ManifestResource {
  resourceType: string;
}

export interface ModuleManifest {
  moduleId?: string;
  actions?: ManifestAction[];
  resources?: ManifestResource[];
}

/**
 * The bundled per-module manifests, in deterministic order. Each manifest
 * declares the actions / resources / events / projections / migrations
 * owned by exactly one module. Consumers that need the full registry
 * (action catalog, Cedar schema generation, etc.) should iterate this
 * array; deduplication semantics on collision live in the consumer.
 */
const MODULE_MANIFESTS: ReadonlyArray<ModuleManifest> = [
  authzManifest as ModuleManifest,
  contentPagesManifest as ModuleManifest,
  structuredCatalogManifest as ModuleManifest,
];

/**
 * Per-module manifests, in stable, deterministic order. This is the
 * preferred accessor — `moduleManifest()` (singular) is retained only
 * for backwards compatibility and returns a *merged* view.
 */
export function moduleManifests(): ReadonlyArray<ModuleManifest> {
  return MODULE_MANIFESTS;
}

/**
 * Backwards-compat shim: returns a single object with merged
 * `actions` + `resources` arrays across all bundled manifests. New
 * callers MUST use `moduleManifests()` and iterate. This shim survives
 * only to keep older fixture call sites working through the migration.
 *
 * @deprecated Use `moduleManifests()` instead. This function discards
 * per-module metadata (moduleId, version, events, projections, etc.)
 * and only exposes the merged action/resource view.
 */
export function moduleManifest(): unknown {
  const actions: Array<unknown> = [];
  const resources: Array<unknown> = [];
  for (const m of MODULE_MANIFESTS) {
    const obj = m as { actions?: unknown[]; resources?: unknown[] };
    if (Array.isArray(obj.actions)) actions.push(...obj.actions);
    if (Array.isArray(obj.resources)) resources.push(...obj.resources);
  }
  return { actions, resources };
}

export function badgeFamilySeed(): unknown {
  return badgeFamilySeedRaw;
}
