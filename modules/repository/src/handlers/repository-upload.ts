/**
 * `Repository.Upload` handler.
 *
 * Decodes the base64 tarball payload, asserts the size cap and content
 * hash, mints a new `revisionId`, persists bytes + metadata via
 * `RepositoryRevisionStore`, and emits `Repository.Uploaded`.
 *
 * Validation order — fail-fast:
 *
 *   1. Repo exists for `(tenantId, repoId)` — else `REPO_NOT_FOUND` (404).
 *   2. `byteCount <= UPLOAD_BYTE_LIMIT` (10 MB) — else `UPLOAD_TOO_LARGE`
 *      (413). Asserted on the *claimed* count first so a malicious or
 *      typo'd huge `byteCount` is rejected without decoding the payload.
 *   3. Decoded `bytes.byteLength === byteCount` — else `UPLOAD_TOO_LARGE`
 *      (413). Defensive against a payload that doesn't match its claimed
 *      size.
 *   4. `sha256(bytes) === contentHash` — else `CONTENT_HASH_MISMATCH`
 *      (400). The handler computes the hash, hex-encodes it, and
 *      lowercase-compares.
 *
 * Idempotency lives on the envelope's `idempotencyKey` (set by ingress
 * from the inbound `IntentEnvelope`). This handler does not dedup on
 * `revisionId` — a fresh id is minted every call. The architectural
 * choice: each push is its own revision; `Ctrl-C-and-retry` produces
 * two revisions, which matches the developer-experience contract in the
 * spec ("CLI generates a fresh key per push").
 *
 * Cache-invalidation tags:
 *   `['Tenant:${tenantId}', 'Repository:${repoId}', 'Revision:${revisionId}']`
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type {
  Crypto,
  EventStore,
  RepositoryStore,
  RepositoryRevisionStore,
} from '@atlas/ports';
import { RepositoryError, codes } from '../errors.ts';
import { newEventId, newRevisionId } from '../ids.ts';
import {
  REPOSITORY_UPLOADED_EVENT_TYPE,
  REPOSITORY_UPLOADED_SCHEMA_ID,
  REPOSITORY_UPLOADED_SCHEMA_VERSION,
} from '../events.ts';
import {
  UPLOAD_BYTE_LIMIT,
  type RepositoryUploadCommand,
  type RepositoryUploadResult,
  type RepositoryUploadedPayload,
} from '../types.ts';

function sha256Hex(bytes: Uint8Array, crypto: Crypto): string {
  const digest = crypto.sha256(bytes);
  let hex = '';
  for (let i = 0; i < digest.length; i += 1)
    hex += digest[i]!.toString(16).padStart(2, '0');
  return hex;
}

function base64Decode(str: string): Uint8Array {
  const bin = globalThis.atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function handleRepositoryUpload(
  cmd: RepositoryUploadCommand,
  repositories: RepositoryStore,
  revisions: RepositoryRevisionStore,
  eventStore: EventStore,
  crypto: Crypto,
): Promise<RepositoryUploadResult> {
  // 1. Repo must exist in the tenant scope. Cross-tenant lookups return
  //    null at the port boundary (I7).
  const repo = await repositories.get(cmd.tenantId, cmd.repoId);
  if (!repo) {
    throw new RepositoryError(
      codes.REPO_NOT_FOUND,
      `repository not found: ${cmd.repoId}`,
      404,
    );
  }

  // 2. Size cap on the claimed byteCount — fail before decoding to dodge
  //    the work + memory cost of base64-decoding a 1 GB payload.
  if (cmd.byteCount > UPLOAD_BYTE_LIMIT) {
    throw new RepositoryError(
      codes.UPLOAD_TOO_LARGE,
      `upload exceeds ${UPLOAD_BYTE_LIMIT}-byte cap: ${cmd.byteCount}`,
      413,
    );
  }

  // 3. Decode + re-check size against the actual payload.
  const bytes = base64Decode(cmd.bytesBase64);
  if (bytes.byteLength !== cmd.byteCount) {
    throw new RepositoryError(
      codes.UPLOAD_TOO_LARGE,
      `decoded byteLength ${bytes.byteLength} does not match claimed byteCount ${cmd.byteCount}`,
      413,
    );
  }
  if (bytes.byteLength > UPLOAD_BYTE_LIMIT) {
    throw new RepositoryError(
      codes.UPLOAD_TOO_LARGE,
      `decoded payload exceeds ${UPLOAD_BYTE_LIMIT}-byte cap: ${bytes.byteLength}`,
      413,
    );
  }

  // 4. Hash check. Lowercase compare so a hex-uppercased contentHash
  //    from the CLI doesn't false-negative.
  const computedHash = sha256Hex(bytes, crypto);
  if (computedHash !== cmd.contentHash.toLowerCase()) {
    throw new RepositoryError(
      codes.CONTENT_HASH_MISMATCH,
      `contentHash mismatch: expected ${computedHash}, got ${cmd.contentHash}`,
      400,
    );
  }

  const revisionId = newRevisionId();
  const occurredAt = new Date().toISOString();

  await revisions.append(cmd.tenantId, {
    revisionId,
    repoId: cmd.repoId,
    bytes,
    byteCount: bytes.byteLength,
    contentHash: computedHash,
    pushedBy: cmd.principalId,
    correlationId: cmd.correlationId,
  });

  const revision = {
    revisionId,
    repoId: cmd.repoId,
    byteCount: bytes.byteLength,
    contentHash: computedHash,
    pushedAt: occurredAt,
    pushedBy: cmd.principalId,
    correlationId: cmd.correlationId,
  };

  const payload: RepositoryUploadedPayload = {
    repoId: cmd.repoId,
    revisionId,
    byteCount: bytes.byteLength,
    contentHash: computedHash,
    pushedBy: cmd.principalId,
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: REPOSITORY_UPLOADED_EVENT_TYPE,
    schemaId: REPOSITORY_UPLOADED_SCHEMA_ID,
    schemaVersion: REPOSITORY_UPLOADED_SCHEMA_VERSION,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `repository.upload.${cmd.tenantId}.${revisionId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `Repository:${cmd.repoId}`,
      `Revision:${revisionId}`,
    ],
    payload,
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return { envelope, revision };
}
