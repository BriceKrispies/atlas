/**
 * Widget manifest validation — wraps ajv against widget_manifest.schema.json.
 */

import Ajv from 'ajv';
import manifestSchema from './schemas/widget_manifest.schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = ajv.compile(manifestSchema);

/**
 * @param {unknown} manifest
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function validateManifest(manifest) {
  const ok = compiled(manifest);
  if (ok) return { ok: true, errors: [] };
  const errors = (compiled.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }));
  return { ok: false, errors };
}
