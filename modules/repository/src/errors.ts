/**
 * Repository module error taxonomy. Mirrors the shape of `TenancyError`:
 * a `code` (taxonomy string), human message, and a suggested HTTP status.
 * The wiring layer maps these to error envelopes.
 *
 * Codes are referenced by the `Repository.Create` and `Repository.Upload`
 * intent handlers. The full canonical taxonomy lives in
 * `specs/crosscut/errors.md`.
 */

export const codes = {
  REPO_NOT_FOUND: 'REPO_NOT_FOUND',
  REPO_SLUG_TAKEN: 'REPO_SLUG_TAKEN',
  REVISION_NOT_FOUND: 'REVISION_NOT_FOUND',
  UPLOAD_TOO_LARGE: 'UPLOAD_TOO_LARGE',
  CONTENT_HASH_MISMATCH: 'CONTENT_HASH_MISMATCH',
} as const;

export type RepositoryErrorCode = (typeof codes)[keyof typeof codes];

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly status: number;

  constructor(code: RepositoryErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.status = status;
  }
}
