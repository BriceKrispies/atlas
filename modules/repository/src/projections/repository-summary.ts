/**
 * `repository_summary` projection.
 *
 * The canonical `RepositoryStore` row IS the summary read-model. The
 * dispatcher's job is to idempotently apply `Repository.Created` events
 * to the store — at write-time it's a no-op (the handler already
 * inserted the row), at worker-mode replay-from-events it materializes
 * the row that wasn't yet written.
 *
 * Idempotent-on-replay: `applyRepositorySummary` calls `getBySlug`
 * before `create`, so a second pass over the same event is a no-op.
 * This satisfies I12 — projections rebuildable from event history alone
 * — without double-writing in the inline path.
 *
 * Consumed events:
 *   - `Repository.Created` — upsert the canonical row.
 *   - `Repository.Uploaded` — no-op here; the latest-revision pointer
 *     is derived on-read by `getRepository` if/when a separate summary
 *     view is added in a follow-up. For now, list/get reads return the
 *     canonical record directly.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { RepositoryStore } from '@atlas/ports';
import { REPOSITORY_CREATED_EVENT_TYPE } from '../events.ts';
import type { RepositoryCreatedPayload } from '../types.ts';

/**
 * Apply a single envelope to the canonical `RepositoryStore`.
 * Idempotent: existing slugs are preserved unchanged.
 */
export async function applyRepositorySummary(
  envelope: EventEnvelope,
  repositories: RepositoryStore,
): Promise<void> {
  if (envelope.eventType !== REPOSITORY_CREATED_EVENT_TYPE) return;
  const payload = envelope.payload as RepositoryCreatedPayload;
  const principalId = envelope.principalId ?? 'unknown';

  // Idempotent: if the slug already exists in this tenant, leave the
  // row alone. The handler's write at the time the event was emitted
  // is the source of truth; a worker rebuild only fills gaps.
  const existing = await repositories.getBySlug(envelope.tenantId, payload.repoSlug);
  if (existing) return;

  await repositories.create(envelope.tenantId, {
    repoId: payload.repoId,
    repoSlug: payload.repoSlug,
    name: payload.name,
    ...(payload.description !== null
      ? { description: payload.description }
      : {}),
    createdBy: principalId,
  });
}

/**
 * Rebuild the repository projection for a tenant from a replay of its
 * event stream. Used by the I12 dispatch test.
 */
export async function rebuildRepositorySummary(
  envelopes: ReadonlyArray<EventEnvelope>,
  repositories: RepositoryStore,
): Promise<void> {
  for (const env of envelopes) {
    await applyRepositorySummary(env, repositories);
  }
}
