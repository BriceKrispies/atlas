/**
 * Page-template manifest validation — wraps ajv against
 * page_template.schema.json.
 */

import Ajv, { type ValidateFunction } from 'ajv';
import templateSchema from './schemas/page_template.schema.json' with { type: 'json' };

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled: ValidateFunction = ajv.compile(templateSchema);

export function validateTemplateManifest(manifest: unknown): ValidationResult {
  const ok = compiled(manifest);
  if (ok) return { ok: true, errors: [] };
  const errors: ValidationError[] = (compiled.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }));
  return { ok: false, errors };
}
