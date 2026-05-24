import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction, AnySchemaObject } from 'ajv/dist/2020.js';

export type { ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json' with { type: 'json' };

import seedApply from './generated/catalog.seed_package.apply.v1.schema.json' with { type: 'json' };
import familyPublish from './generated/catalog.family.publish.v1.schema.json' with { type: 'json' };
import seedApplied from './generated/catalog.seed_package_applied.v1.schema.json' with {
  type: 'json',
};
import familyPublished from './generated/catalog.family_published.v1.schema.json' with {
  type: 'json',
};
import variantUpserted from './generated/catalog.variant_upserted.v1.schema.json' with {
  type: 'json',
};
import policyEvaluated from './generated/platform.policy_evaluated.v1.schema.json' with {
  type: 'json',
};
import authzPolicyCreate from './generated/authz.policy.create.v1.schema.json' with {
  type: 'json',
};
import authzPolicyActivate from './generated/authz.policy.activate.v1.schema.json' with {
  type: 'json',
};
import authzPolicyArchive from './generated/authz.policy.archive.v1.schema.json' with {
  type: 'json',
};
import contentPagesPageCreate from './generated/content_pages.page.create.v1.schema.json' with {
  type: 'json',
};
import contentPagesPageUpdate from './generated/content_pages.page.update.v1.schema.json' with {
  type: 'json',
};
import contentPagesPageDelete from './generated/content_pages.page.delete.v1.schema.json' with {
  type: 'json',
};
import contentPagesPageRead from './generated/content_pages.page.read.v1.schema.json' with {
  type: 'json',
};
import dslExpressionUpdate from './generated/dsl.expression.update.v1.schema.json' with {
  type: 'json',
};
import dslExpressionUpdated from './generated/dsl.expression.updated.v1.schema.json' with {
  type: 'json',
};
import seedScenario from './generated/seed.scenario.v1.schema.json' with { type: 'json' };
import seedFixture from './generated/seed.fixture.v1.schema.json' with { type: 'json' };
import seedTemplate from './generated/seed.template.v1.schema.json' with { type: 'json' };
import seedAxisDefinition from './generated/seed.axis_definition.v1.schema.json' with {
  type: 'json',
};
import eventEnvelope from './generated/event_envelope.schema.json' with { type: 'json' };
import structuredCatalogManifest from './generated/manifests/structured-catalog.manifest.json' with {
  type: 'json',
};
import authzManifest from './generated/manifests/authz.manifest.json' with { type: 'json' };
import contentPagesManifest from './generated/manifests/content-pages.manifest.json' with {
  type: 'json',
};
import dslExpressionManifest from './generated/manifests/dsl-expression.manifest.json' with {
  type: 'json',
};
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
  dslExpressionUpdate as AnySchemaObject,
  dslExpressionUpdated as AnySchemaObject,
  seedScenario as AnySchemaObject,
  seedFixture as AnySchemaObject,
  seedTemplate as AnySchemaObject,
  seedAxisDefinition as AnySchemaObject,
];

/**
 * Construct a fresh ajv instance configured for Atlas schema compilation:
 * non-strict, all-errors, `addFormats`, and the draft-07 meta-schema
 * registered (the seeder schemas declare $schema=draft-07; AJV2020 doesn't
 * load that meta-schema by default).
 *
 * Used in two places: (1) the bundled-set ajv that backs the static
 * `getSchemaValidator(schemaId, version)` lookup of `@atlas/schemas`-shipped
 * schemas, and (2) one-off per-document instances inside `compileValidator`
 * for runtime-supplied schema docs (so re-compiling the same `$id` is allowed
 * — a single shared ajv would reject a duplicate `$id`).
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#ajv-compile-on-demand--cache-invalidation
 */
function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addMetaSchema(draft7MetaSchema as AnySchemaObject);
  return ajv;
}

/**
 * The ajv instance holding the bundled `@atlas/schemas` set. This is NOT a
 * permanently-memoized single ajv for the whole package any more — it backs
 * only the lookup of bundled schema ids via `getSchemaValidator`. Runtime
 * schema docs compile through `compileValidator` into their own ajv instances,
 * so a schema registered at runtime no longer requires rebuilding the package.
 */
let bundledAjv: Ajv2020 | null = null;

function getBundledAjv(): Ajv2020 {
  if (bundledAjv) return bundledAjv;
  const ajv = newAjv();
  ajv.addSchema(eventEnvelope as AnySchemaObject);
  for (const s of SCHEMAS) {
    ajv.addSchema(s);
  }
  bundledAjv = ajv;
  return ajv;
}

/**
 * Test-only override map. Keyed by `schemaId`; when set, `getSchemaValidator`
 * returns the value (including `null`) instead of consulting Ajv. Tests use
 * it to simulate a missing validator — replaces the legacy
 * `vi.spyOn(schemasModule, 'getSchemaValidator')` pattern, which can't work
 * under Node ESM (module exports are read-only).
 *
 * Production code paths are unaffected when the map is empty.
 */
const _schemaValidatorOverrides = new Map<string, ValidateFunction | null>();

/**
 * @internal — test-only.
 * Pass `value=null` to simulate "validator missing for this schemaId".
 * Pass `value=undefined` to clear the override.
 */
export function __setSchemaValidatorOverrideForTest(
  schemaId: string,
  value: ValidateFunction | null | undefined,
): void {
  if (value === undefined) _schemaValidatorOverrides.delete(schemaId);
  else _schemaValidatorOverrides.set(schemaId, value);
}

/**
 * Compile an ajv validator from a schema document supplied at runtime.
 *
 * Each call compiles `document` into a fresh ajv instance (configured with
 * `addFormats` + the draft-07 meta-schema, matching the bundled set). A fresh
 * instance per document is deliberate: it lets a runtime-registered schema use
 * any `$id` — including re-registering the same `$id` under a bumped version —
 * without colliding with a previously-registered `$id` in a shared ajv. The
 * control-plane registry adapters own the per-`(schemaId, schemaVersion)`
 * cache + version-driven invalidation; this function is the pure compile step.
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#ajv-compile-on-demand--cache-invalidation
 */
export function compileValidator(document: Record<string, unknown>): ValidateFunction {
  const ajv = newAjv();
  return ajv.compile(document as AnySchemaObject);
}

export function getSchemaValidator(schemaId: string, _version: number): ValidateFunction | null {
  if (_schemaValidatorOverrides.has(schemaId)) {
    return _schemaValidatorOverrides.get(schemaId) ?? null;
  }
  const ajv = getBundledAjv();
  const v = ajv.getSchema(schemaId);
  return (v as ValidateFunction | undefined) ?? null;
}

/**
 * A bundled schema-seed row: the `(schemaId, schemaVersion, document)` shape
 * the control-plane registry seeds on first boot. Derived from the static
 * `SCHEMAS` array — each bundled schema's `$id` is its `schemaId`; bundled
 * schemas are all version 1.
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#seed-from-bundle-on-boot-idempotent
 */
export interface BundledSchemaSeedRow {
  schemaId: string;
  schemaVersion: number;
  document: Record<string, unknown>;
}

/**
 * The bundled `@atlas/schemas` set as a seed corpus for the control-plane
 * schema registry. Each row's `schemaId` is the schema document's `$id`;
 * bundled schemas are version 1. Schemas without an `$id` are skipped (they
 * can't be keyed). This is the SEED, not the live source — the control-plane
 * table, once seeded, is authoritative.
 */
export function bundledSchemaSeed(): ReadonlyArray<BundledSchemaSeedRow> {
  const rows: BundledSchemaSeedRow[] = [];
  for (const s of SCHEMAS) {
    const id = (s as { $id?: unknown }).$id;
    if (typeof id !== 'string' || id.length === 0) continue;
    rows.push({
      schemaId: id,
      schemaVersion: 1,
      document: s as Record<string, unknown>,
    });
  }
  return rows;
}

/**
 * A bundled action-seed row: the `ActionEntry`-shaped catalog entry the
 * control-plane registry seeds on first boot, plus provenance `moduleId`.
 * `schemaId`/`schemaVersion` are derived from `actionId` via the shared
 * `actionIdToSchemaId` convention (PascalCase → lower_snake `.v1`).
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#seed-from-bundle-on-boot-idempotent
 */
export interface BundledActionSeedRow {
  actionId: string;
  resourceType: string;
  schemaId: string;
  schemaVersion: number;
  moduleId?: string;
}

// Convention mapping shared with the adapters' `actionIdToSchemaId`
// (`adapters/node/src/action-schema-id.ts`). Kept here so the seed corpus is
// derivable from `@atlas/schemas` alone (the seed source of truth) without an
// adapter import.
const PASCAL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g;
function toSnake(segment: string): string {
  return segment.replace(PASCAL_BOUNDARY, '_').toLowerCase();
}
function deriveSchemaId(actionId: string): { schemaId: string; schemaVersion: number } {
  const segments = actionId
    .split('.')
    .map(toSnake)
    .filter(function (s) {
      return s.length > 0;
    });
  return { schemaId: `${segments.join('.')}.v1`, schemaVersion: 1 };
}

/**
 * The bundled module manifests' action catalog as a seed corpus for the
 * control-plane action_entries table. Only actions whose derived schema is
 * present in the bundled set are seeded — matching the adapters' existing
 * tolerance of manifest entries with no bundled schema. On duplicate
 * `actionId`, last manifest wins (same last-wins rule the adapters apply).
 */
export function bundledActionSeed(): ReadonlyArray<BundledActionSeedRow> {
  const byActionId = new Map<string, BundledActionSeedRow>();
  for (const manifest of MODULE_MANIFESTS) {
    const moduleId = manifest.moduleId;
    for (const a of manifest.actions ?? []) {
      const { schemaId, schemaVersion } = deriveSchemaId(a.actionId);
      if (getSchemaValidator(schemaId, schemaVersion) == null) continue;
      const row: BundledActionSeedRow = {
        actionId: a.actionId,
        resourceType: a.resourceType,
        schemaId,
        schemaVersion,
      };
      // Only attach `moduleId` when present — `exactOptionalPropertyTypes`
      // forbids assigning an explicit `undefined` to an optional property.
      if (moduleId !== undefined) row.moduleId = moduleId;
      byActionId.set(a.actionId, row);
    }
  }
  return Array.from(byActionId.values());
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
  dslExpressionManifest as ModuleManifest,
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
