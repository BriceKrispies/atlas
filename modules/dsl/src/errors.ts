/**
 * DSL handler error taxonomy. Sits at the request boundary — the module's
 * handler maps parse/static-check failures and storage failures into a
 * single `DslHandlerError` class the wiring layer can convert to an HTTP
 * envelope without knowing about substrate or port internals.
 *
 * Note: this is the HANDLER-side error class. The substrate ships its own
 * `DslError` (without `status` or `Error` shape) — those flow inside the
 * handler when parse / static-check / evaluate fails, and the handler
 * wraps them into this class with an HTTP-friendly `status`.
 *
 * Mirrors `ContentPagesError` in shape (per `modules/content-pages/src/errors.ts`).
 */

import type { SourceRange } from '@atlas/dsl-substrate';

export const codes = {
  DSL_UNKNOWN_KIND: 'DSL_UNKNOWN_KIND',
  DSL_PARSE_ERROR: 'DSL_PARSE_ERROR',
  DSL_TYPE_ERROR: 'DSL_TYPE_ERROR',
  DSL_UNKNOWN_IDENTIFIER: 'DSL_UNKNOWN_IDENTIFIER',
  DSL_BROKEN_REFERENCE: 'DSL_BROKEN_REFERENCE',
  DSL_SUBSTRATE_VERSION_MISMATCH: 'DSL_SUBSTRATE_VERSION_MISMATCH',
  DSL_ARTIFACT_NOT_FOUND: 'DSL_ARTIFACT_NOT_FOUND',
  DSL_INVALID_API_NAME: 'DSL_INVALID_API_NAME',
} as const;

export type DslHandlerErrorCode = (typeof codes)[keyof typeof codes];

export class DslHandlerError extends Error {
  readonly code: DslHandlerErrorCode;
  readonly status: number;
  readonly sourceRange?: SourceRange;
  readonly suggestion?: string;

  constructor(
    code: DslHandlerErrorCode,
    message: string,
    status = 400,
    extras?: { sourceRange?: SourceRange; suggestion?: string },
  ) {
    super(message);
    this.name = 'DslHandlerError';
    this.code = code;
    this.status = status;
    if (extras?.sourceRange) this.sourceRange = extras.sourceRange;
    if (extras?.suggestion) this.suggestion = extras.suggestion;
  }
}

/**
 * RFC 1035-ish identifier convention reused for `api_name`. Tenant-supplied;
 * has to be SQL-identifier-safe (won't quote-bypass the storage layer) and
 * URL-safe (it appears in `GET /api/v1/dsl/<kind>/:apiName`).
 *
 * Allowed: lowercase letters, digits, underscores. Must start with a letter
 * and be 1..63 chars.
 */
export const API_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export function assertApiName(apiName: string): void {
  if (!API_NAME_PATTERN.test(apiName)) {
    throw new DslHandlerError(
      codes.DSL_INVALID_API_NAME,
      `invalid apiName '${apiName}' — must match ${API_NAME_PATTERN.toString()}`,
      400,
    );
  }
}
