/**
 * `revision_list` projection.
 *
 * The canonical `RepositoryRevisionStore.listForRepo` IS the revision
 * read-model. The dispatcher's job is to idempotently re-materialize
 * revision **metadata** rows from `Repository.Uploaded` events.
 *
 * **Bytes are not on the event payload.** The 10 MB cap makes inline
 * bytes-on-event prohibitive; the handler writes bytes through the
 * canonical store at the time the event is emitted. A worker-mode
 * rebuild from events cannot recover bytes — only metadata. That
 * mirrors the spec's split between `RepositoryStore` (metadata, fully
 * rebuildable from events) and `RepositoryRevisionStore` (bytes, durable
 * but not derived from event history).
 *
 * For Phase 1 this is fine: the inline write path always co-writes
 * bytes + metadata + event, so worker-mode replays don't run on
 * not-already-persisted bytes.
 *
 * Idempotent-on-replay: `applyRevisionList` checks `getMetadata` before
 * `append`, so a second pass over the same event is a no-op.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { RepositoryRevisionStore } from '@atlas/ports';
import { REPOSITORY_UPLOADED_EVENT_TYPE } from '../events.ts';
import type { RepositoryUploadedPayload } from '../types.ts';

function isRepositoryUploadedEvent(
  envelope: EventEnvelope,
): envelope is EventEnvelope<'Repository.Uploaded', RepositoryUploadedPayload> {
  return envelope.eventType === REPOSITORY_UPLOADED_EVENT_TYPE;
}

/**
 * Apply a single envelope to the revision-metadata read-model.
 * No-op for events outside the consumed set, or when the metadata row
 * already exists.
 */
export async function applyRevisionList(
  envelope: EventEnvelope,
  revisions: RepositoryRevisionStore,
): Promise<void> {
  if (!isRepositoryUploadedEvent(envelope)) return;
  const payload = envelope.payload;

  const existing = await revisions.getMetadata(
    envelope.tenantId,
    payload.revisionId,
  );
  if (existing) return;

  // No bytes available on the event — synthesize an empty payload so
  // the metadata row materializes. This branch only runs when the
  // canonical write was lost (extremely unusual; e.g. a partial
  // recovery from an event-store backup). Operators can re-fetch the
  // bytes from the original push if needed.
  await revisions.append(envelope.tenantId, {
    revisionId: payload.revisionId,
    repoId: payload.repoId,
    bytes: new Uint8Array(0),
    byteCount: payload.byteCount,
    contentHash: payload.contentHash,
    pushedBy: payload.pushedBy,
    correlationId: envelope.correlationId,
  });
}

/**
 * Rebuild revision metadata for a tenant from an event-stream replay.
 * Used by the I12 dispatch test.
 */
export async function rebuildRevisionList(
  envelopes: ReadonlyArray<EventEnvelope>,
  revisions: RepositoryRevisionStore,
): Promise<void> {
  for (const env of envelopes) {
    await applyRevisionList(env, revisions);
  }
}
