/**
 * Identity error taxonomy. Mirrors `@atlas/authz` and
 * `@atlas/content-pages`: a `code` (taxonomy string), human message,
 * suggested HTTP status. The wiring layer maps these to error envelopes.
 */

export const codes = {
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  USER_SUSPENDED: 'USER_SUSPENDED',
  MEMBERSHIP_NOT_FOUND: 'MEMBERSHIP_NOT_FOUND',
  MEMBERSHIP_REQUIRED: 'MEMBERSHIP_REQUIRED',
  INVITE_NOT_FOUND: 'INVITE_NOT_FOUND',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INVITE_ALREADY_USED: 'INVITE_ALREADY_USED',
  INVITE_REASON_REQUIRED: 'INVITE_REASON_REQUIRED',
  PASSWORD_INVALID: 'PASSWORD_INVALID',
  PASSWORD_COMPLEXITY: 'PASSWORD_COMPLEXITY',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  RATE_LIMITED: 'RATE_LIMITED',
  IDENTITY_INVALID: 'IDENTITY_INVALID',
} as const;

export type IdentityErrorCode = (typeof codes)[keyof typeof codes];

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  readonly status: number;

  constructor(code: IdentityErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
    this.status = status;
  }
}
