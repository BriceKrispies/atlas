// Error code taxonomy for the catalog module. Aligned with
// `crates/catalog/src/errors.rs` (Rust). Adding a code here:
//   1. confirm Rust emits the same string,
//   2. update any tests/handlers that surface the code.

/**
 * Canonical catalog error code strings.
 *
 * Names match the Rust `CatalogError` variants in
 * `crates/catalog/src/errors.rs` exactly so that parity tests and clients
 * see identical strings regardless of which backend served the request.
 */
export type CatalogErrorCode =
  | 'INVALID_SEED_PAYLOAD'
  | 'FAMILY_NOT_FOUND'
  | 'FAMILY_REVISION_NOT_FOUND'
  | 'ATTRIBUTE_NOT_FOUND'
  | 'TENANT_DB_UNAVAILABLE'
  | 'STORAGE_FAILED'
  | 'EVENT_APPEND_FAILED';

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CatalogError';
  }
}
