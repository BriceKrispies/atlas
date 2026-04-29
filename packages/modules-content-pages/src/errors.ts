/**
 * ContentPages error taxonomy. Mirrors the shape of `@atlas/modules-authz`'s
 * `AuthzError`: a `code` (taxonomy string), human message, and a
 * suggested HTTP status. The wiring layer maps these to error envelopes.
 */

export const codes = {
  PAGE_NOT_FOUND: 'PAGE_NOT_FOUND',
  PAGE_INVALID: 'PAGE_INVALID',
} as const;

export type ContentPagesErrorCode = (typeof codes)[keyof typeof codes];

export class ContentPagesError extends Error {
  readonly code: ContentPagesErrorCode;
  readonly status: number;

  constructor(code: ContentPagesErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'ContentPagesError';
    this.code = code;
    this.status = status;
  }
}
