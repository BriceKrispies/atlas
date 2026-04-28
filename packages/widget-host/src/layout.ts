/**
 * Page layout validation — wraps ajv against page_layout.schema.json.
 */

import Ajv from 'ajv';
import type { Schema, ValidateFunction } from 'ajv';
import layoutSchema from './schemas/page_layout.schema.json' with { type: 'json' };
import type { PageLayout } from './types.ts';

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled: ValidateFunction<PageLayout> = ajv.compile<PageLayout>(
  layoutSchema as Schema,
);

export function validateLayout(layout: unknown): ValidationResult {
  const ok = compiled(layout);
  if (ok) return { ok: true, errors: [] };
  const errors: ValidationError[] = (compiled.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }));
  return { ok: false, errors };
}
