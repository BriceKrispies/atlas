// Validation dispatcher for the spec-validate harness.
//
// Port of `crates/spec_validate/src/validate/mod.rs`. Each `Kind` maps to
// the corresponding `validate*` function from `../validation.ts`. For the
// list-shaped kinds (`search_documents`, `analytics_events`), the JSON
// fixture may be either a bare array or an object with the conventional
// wrapper field (`{ documents: [...] }` / `{ events: [...] }`).

import { ValidationError } from '../validation.ts';
import {
  validateEventEnvelope,
  validateModuleManifest,
  validateSearchDocuments,
  validateAnalyticsEvents,
} from '../validation.ts';
import type { Kind } from './discover.ts';

/**
 * Error from a validation adapter. Mirrors the Rust `AdapterError` enum:
 * - `Deserialize` — value didn't shape-match the expected domain type
 *   (e.g. wrapper key missing for SearchDocuments / AnalyticsEvents)
 * - `Validation` — domain-level rule failed
 */
export class AdapterError extends Error {
  override readonly name = 'AdapterError';
  readonly tag: 'Deserialize' | 'Validation';
  override readonly cause: unknown;
  constructor(tag: 'Deserialize' | 'Validation', message: string, cause?: unknown) {
    super(tag === 'Deserialize' ? `Deserialization failed: ${message}` : `Validation failed: ${message}`);
    this.tag = tag;
    this.cause = cause;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Unwrap `{ <wrapperField>: [...] }` or pass through a bare array. */
function unwrapList(value: unknown, wrapperField: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObject(value)) {
    const inner = value[wrapperField];
    if (inner === undefined) {
      throw new AdapterError('Deserialize', `Missing '${wrapperField}' field`);
    }
    if (!Array.isArray(inner)) {
      throw new AdapterError(
        'Deserialize',
        `'${wrapperField}' field must be an array`,
      );
    }
    return inner;
  }
  throw new AdapterError(
    'Deserialize',
    `Expected object with '${wrapperField}' field or array`,
  );
}

/**
 * Run the validator that corresponds to `kind` against `value`. Returns
 * `void` on success; throws {@link AdapterError} on failure.
 */
export function validate(kind: Kind, value: unknown): void {
  try {
    switch (kind) {
      case 'event_envelope':
        validateEventEnvelope(value);
        return;
      case 'module_manifest':
        validateModuleManifest(value);
        return;
      case 'search_documents': {
        const arr = unwrapList(value, 'documents');
        validateSearchDocuments(arr);
        return;
      }
      case 'analytics_events': {
        const arr = unwrapList(value, 'events');
        validateAnalyticsEvents(arr);
        return;
      }
    }
  } catch (e) {
    if (e instanceof AdapterError) throw e;
    if (e instanceof ValidationError) {
      throw new AdapterError('Validation', e.message, e);
    }
    // Anything else is a shape error (TypeError from non-object/array etc.)
    throw new AdapterError('Deserialize', e instanceof Error ? e.message : String(e), e);
  }
}
