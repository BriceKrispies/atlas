import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction, AnySchemaObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import seedApply from './generated/catalog.seed_package.apply.v1.schema.json' with { type: 'json' };
import familyPublish from './generated/catalog.family.publish.v1.schema.json' with { type: 'json' };
import seedApplied from './generated/catalog.seed_package_applied.v1.schema.json' with { type: 'json' };
import familyPublished from './generated/catalog.family_published.v1.schema.json' with { type: 'json' };
import variantUpserted from './generated/catalog.variant_upserted.v1.schema.json' with { type: 'json' };
import moduleManifestRaw from './generated/module.manifest.json' with { type: 'json' };
import badgeFamilySeedRaw from './generated/badge-family.json' with { type: 'json' };

const SCHEMAS: ReadonlyArray<AnySchemaObject> = [
  seedApply as AnySchemaObject,
  familyPublish as AnySchemaObject,
  seedApplied as AnySchemaObject,
  familyPublished as AnySchemaObject,
  variantUpserted as AnySchemaObject,
];

let cachedAjv: Ajv2020 | null = null;

function getAjv(): Ajv2020 {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
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

export function moduleManifest(): unknown {
  return moduleManifestRaw;
}

export function badgeFamilySeed(): unknown {
  return badgeFamilySeedRaw;
}
