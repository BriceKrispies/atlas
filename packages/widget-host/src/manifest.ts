/**
 * Widget manifest validation — wraps ajv against widget_manifest.schema.json.
 */

import Ajv from 'ajv';
import type { Schema, ValidateFunction } from 'ajv';
import manifestSchema from './schemas/widget_manifest.schema.json' with { type: 'json' };
import type { WidgetManifest } from './types.ts';
import type { ValidationResult } from './layout.ts';

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled: ValidateFunction<WidgetManifest> = ajv.compile<WidgetManifest>(
  manifestSchema as Schema,
);

export function validateManifest(manifest: unknown): ValidationResult {
  const ok = compiled(manifest);
  if (ok) return { ok: true, errors: [] };
  const errors = (compiled.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }));
  return { ok: false, errors };
}
