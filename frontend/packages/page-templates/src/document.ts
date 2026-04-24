/**
 * Page-document validation — wraps ajv against page_document.schema.json.
 * The document schema $refs WidgetInstance from page-layout.v1.json, so
 * we register both schemas on the ajv instance by $id before compiling.
 */

import Ajv, { type ValidateFunction } from 'ajv';
import pageDocSchema from './schemas/page_document.schema.json' with { type: 'json' };
import pageLayoutSchema from './schemas/page_layout.schema.json' with { type: 'json' };

import type { ValidationResult, ValidationError } from './manifest.ts';

const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(pageLayoutSchema);
const compiled: ValidateFunction = ajv.compile(pageDocSchema);

export function validatePageDocument(doc: unknown): ValidationResult {
  const ok = compiled(doc);
  if (ok) return { ok: true, errors: [] };
  const errors: ValidationError[] = (compiled.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }));
  return { ok: false, errors };
}
