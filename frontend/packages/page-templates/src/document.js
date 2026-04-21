/**
 * Page-document validation — wraps ajv against page_document.schema.json.
 * The document schema $refs WidgetInstance from page-layout.v1.json, so
 * we register both schemas on the ajv instance by $id before compiling.
 */

import Ajv from 'ajv';
import pageDocSchema from './schemas/page_document.schema.json' with { type: 'json' };
import pageLayoutSchema from './schemas/page_layout.schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(pageLayoutSchema);
const compiled = ajv.compile(pageDocSchema);

/**
 * @param {unknown} doc
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function validatePageDocument(doc) {
  const ok = compiled(doc);
  if (ok) return { ok: true, errors: [] };
  const errors = (compiled.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }));
  return { ok: false, errors };
}
