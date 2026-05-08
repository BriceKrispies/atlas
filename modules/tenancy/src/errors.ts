/**
 * Tenancy error taxonomy. Mirrors `@atlas/identity`: a `code`
 * (taxonomy string), human message, suggested HTTP status. The wiring
 * layer maps these to error envelopes.
 */

export const codes = {
  SIGNUP_NOT_FOUND: 'SIGNUP_NOT_FOUND',
  SIGNUP_NOT_PENDING: 'SIGNUP_NOT_PENDING',
  SIGNUP_INVALID: 'SIGNUP_INVALID',
  TENANT_SLUG_TAKEN: 'TENANT_SLUG_TAKEN',
  TENANT_ALREADY_EXISTS: 'TENANT_ALREADY_EXISTS',
  CUSTOM_DOMAIN_TAKEN: 'CUSTOM_DOMAIN_TAKEN',
} as const;

export type TenancyErrorCode = (typeof codes)[keyof typeof codes];

export class TenancyError extends Error {
  readonly code: TenancyErrorCode;
  readonly status: number;

  constructor(code: TenancyErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'TenancyError';
    this.code = code;
    this.status = status;
  }
}
