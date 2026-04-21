/**
 * Page-template manifest validation — wraps ajv against
 * page_template.schema.json.
 */

import Ajv from 'ajv';
import templateSchema from './schemas/page_template.schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = ajv.compile(templateSchema);

/**
 * @param {unknown} manifest
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function validateTemplateManifest(manifest) {
  const ok = compiled(manifest);
  if (ok) return { ok: true, errors: [] };
  const errors = (compiled.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }));
  return { ok: false, errors };
}
