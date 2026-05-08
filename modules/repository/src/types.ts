/**
 * Repository module — domain types.
 *
 * The on-disk projections live in the per-tenant DB and are exposed via
 * the `RepositoryStore` + `RepositoryRevisionStore` ports, so the
 * record types are re-exported from `@atlas/ports` for convenience.
 *
 * Command/result shapes flow between the route layer (which decodes
 * `IntentEnvelope.payload`) and the handlers in `src/handlers/`. Event
 * payload shapes describe the on-the-wire `EventEnvelope.payload` for
 * the two events emitted by this module.
 */

import type {
  RepositoryRecord,
  RevisionRecord,
} from '@atlas/ports';

export type { RepositoryRecord, RevisionRecord };

// ---------------------------------------------------------------------------
// Repository.Create
// ---------------------------------------------------------------------------

export interface RepositoryCreateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string;
  /** Tenant-unique kebab-case slug (e.g. `hello-world`). */
  repoSlug: string;
  /** Human-friendly display name. Defaults to the slug if not provided. */
  name: string;
  /** Optional free-text description. */
  description?: string;
}

export interface RepositoryCreateResult {
  /**
   * The primary event. `null` when the create was a no-op idempotent
   * retry — the caller already has a row for `(tenantId, repoSlug)`,
   * so no new event is emitted (see the handler docblock for the
   * design rationale).
   */
  envelope: import('@atlas/platform-core').EventEnvelope | null;
  repository: RepositoryRecord;
  /** True when the call was a no-op retry against an existing slug. */
  preexisting: boolean;
}

export interface RepositoryCreatedPayload {
  repoId: string;
  repoSlug: string;
  name: string;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Repository.Upload
// ---------------------------------------------------------------------------

export interface RepositoryUploadCommand {
  tenantId: string;
  correlationId: string;
  principalId: string;
  /** Existing repository to attach the new revision to. */
  repoId: string;
  /** Decoded payload size in bytes. Asserted to equal the decoded length. */
  byteCount: number;
  /** sha256 of the tarball, hex-encoded. Asserted to match the decoded bytes. */
  contentHash: string;
  /** Base64-encoded tarball payload. */
  bytesBase64: string;
}

export interface RepositoryUploadResult {
  envelope: import('@atlas/platform-core').EventEnvelope;
  revision: RevisionRecord;
}

export interface RepositoryUploadedPayload {
  repoId: string;
  revisionId: string;
  byteCount: number;
  contentHash: string;
  /** Principal that pushed the revision (mirrors `RevisionRecord.pushedBy`). */
  pushedBy: string;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Phase 1 hard cap: 10 MB of *decoded* tarball bytes per upload. Tenants
 * who need more wait for the storage upgrade slice (object-storage with
 * presigned multipart upload). The schema validator enforces this at the
 * ingress layer too; the handler re-checks as defense-in-depth.
 */
export const UPLOAD_BYTE_LIMIT = 10 * 1024 * 1024;
