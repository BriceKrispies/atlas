// Error code taxonomy. Aligned with crates/ingress/src/errors.rs (Rust).
// Adding a code here:
//   1. confirm Rust emits the same string,
//   2. add an HTTP status mapping in apps/server/src/middleware/errors.ts,
//   3. update any contract-tests assertions that reference the code.

export interface ErrorBody {
  code: string;
  message: string;
  correlationId: string;
}

/**
 * Canonical ingress error code strings.
 *
 * These are the wire codes returned in the error envelope. Names match the
 * Rust `AppError` constructors in `crates/ingress/src/errors.rs` exactly so
 * that parity tests and clients see identical strings regardless of which
 * backend served the request.
 *
 * Categories (mirrors `specs/error_taxonomy.json`):
 * - VALIDATION: SCHEMA_VALIDATION_FAILED, UNKNOWN_SCHEMA, UNKNOWN_ACTION,
 *   INVALID_IDEMPOTENCY_KEY, IDEMPOTENCY_CONFLICT, MISSING_REQUIRED_FIELDS
 * - AUTHN: PRINCIPAL_INVALID
 * - AUTHZ: UNAUTHORIZED
 * - TENANT: TENANT_MISMATCH
 * - PERSISTENCE: TRANSACTION_FAILED
 *
 * Note: Rust's authn middleware returns a non-structured `{error: "unauthorized"}`
 * body for 401s rather than a taxonomy code. TS canonicalises that path to
 * `PRINCIPAL_INVALID` (the AUTHN-category code from the spec taxonomy) so the
 * envelope shape stays uniform.
 */
export type IngressErrorCode =
  // Validation
  | 'SCHEMA_VALIDATION_FAILED'
  | 'UNKNOWN_SCHEMA'
  | 'UNKNOWN_ACTION'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MISSING_REQUIRED_FIELDS'
  // Authn (401)
  | 'PRINCIPAL_INVALID'
  // Authz (403)
  | 'UNAUTHORIZED'
  // Tenant
  | 'TENANT_MISMATCH'
  // Persistence
  | 'TRANSACTION_FAILED';

export class IngressError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlationId: string;
  constructor(code: string, message: string, status: number, correlationId: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.correlationId = correlationId;
  }
  toBody(): ErrorBody {
    return { code: this.code, message: this.message, correlationId: this.correlationId };
  }
}
