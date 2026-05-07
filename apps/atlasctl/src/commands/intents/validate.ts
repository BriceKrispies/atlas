import { readFileSync, readSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { getSchemaValidator } from '@atlas/schemas';
import { envelopeSchema, ENVELOPE_SCHEMA_ID } from '../../envelope-schema.ts';
import { emitResult, type OutputFlags } from '../../output.ts';
import { newCorrelationId } from '../../correlation.ts';

export interface ValidateOptions {
  file: string;
}

export function runValidate(opts: ValidateOptions, flags: OutputFlags): number {
  const correlationId = newCorrelationId();
  const raw = readJson(opts.file);
  if (!raw.ok) {
    emitResult(flags, {
      correlationId,
      status: 'error',
      message: raw.message,
      errorCode: 'BAD_INPUT',
    });
    return 2;
  }

  const envelopeErrors = validateEnvelope(raw.value);
  if (envelopeErrors.length > 0) {
    emitResult(flags, {
      correlationId,
      status: 'error',
      message: 'envelope validation failed',
      errorCode: 'ENVELOPE_INVALID',
      data: { errors: envelopeErrors },
    });
    return 1;
  }

  // Envelope-level validation passed. Try action-specific payload schema if
  // one is bundled in @atlas/schemas. Missing payload schema is not a hard
  // failure — emit a warning and let the server reject if appropriate.
  const envelope = raw.value as Record<string, unknown>;
  const schemaId = typeof envelope['schemaId'] === 'string' ? envelope['schemaId'] : '';
  const payloadValidator = schemaId !== '' ? getSchemaValidator(schemaId, 1) : null;

  const warnings: string[] = [];
  if (payloadValidator === null) {
    warnings.push(
      `no bundled payload schema for schemaId="${schemaId}" — server-side validation will run on submit`,
    );
  } else {
    const payload = envelope['payload'];
    const ok = payloadValidator(payload);
    if (!ok) {
      emitResult(flags, {
        correlationId,
        status: 'error',
        message: 'payload validation failed',
        errorCode: 'PAYLOAD_INVALID',
        data: { errors: payloadValidator.errors ?? [] },
      });
      return 1;
    }
  }

  emitResult(flags, {
    correlationId,
    status: warnings.length > 0 ? 'warning' : 'ok',
    message: 'valid',
    ...(warnings.length > 0 ? { warnings } : {}),
  });
  return 0;
}

type ReadJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

function readJson(path: string): ReadJsonResult {
  let text: string;
  try {
    text = path === '-' ? readStdinSync() : readFileSync(path, 'utf-8');
  } catch (e) {
    return { ok: false, message: `failed to read ${path}: ${(e as Error).message}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, message: `invalid JSON in ${path}: ${(e as Error).message}` };
  }
}

function readStdinSync(): string {
  const chunks: Buffer[] = [];
  let read = 0;
  const buf = Buffer.alloc(65536);
  while ((read = readSync(0, buf)) > 0) {
    chunks.push(Buffer.from(buf.subarray(0, read)));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// Plain Ajv (draft-07 default) — the envelope schema declares
// $schema: http://json-schema.org/draft-07/schema#, which Ajv2020
// would reject without an explicit draft-07 meta-schema add.
let cachedAjv: Ajv | null = null;
function getEnvelopeAjv(): Ajv {
  if (cachedAjv !== null) return cachedAjv;
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(envelopeSchema);
  cachedAjv = ajv;
  return ajv;
}

function validateEnvelope(value: unknown): unknown[] {
  const ajv = getEnvelopeAjv();
  const validator = ajv.getSchema(ENVELOPE_SCHEMA_ID);
  if (!validator) return [{ message: 'envelope schema not loaded' }];
  const ok = validator(value);
  if (ok) return [];
  return validator.errors ?? [];
}
