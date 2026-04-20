/**
 * Page layout validation — wraps ajv against page_layout.schema.json.
 */

import Ajv from 'ajv';
import layoutSchema from './schemas/page_layout.schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = ajv.compile(layoutSchema);

/**
 * @param {unknown} layout
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function validateLayout(layout) {
  const ok = compiled(layout);
  if (ok) return { ok: true, errors: [] };
  const errors = (compiled.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }));
  return { ok: false, errors };
}
