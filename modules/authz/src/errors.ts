/**
 * Authz module error codes — match the platform error envelope shape so
 * callers (handlers + the server route) can decorate the throw with a
 * `code` field that surfaces to the IngressError translation layer.
 */

export class AuthzError extends Error {
  public readonly code: string;
  public readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AuthzError';
  }
}

export const codes = {
  POLICY_NOT_FOUND: 'POLICY_NOT_FOUND',
  POLICY_NOT_DRAFT: 'POLICY_NOT_DRAFT',
  POLICY_LAST_ACTIVE: 'POLICY_LAST_ACTIVE',
  POLICY_TEXT_INVALID: 'POLICY_TEXT_INVALID',
} as const;
