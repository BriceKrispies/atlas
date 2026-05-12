/**
 * `Repository.Create` handler.
 *
 * Mints a new repository row inside the tenant's per-tenant DB. Idempotent
 * on `(tenantId, repoSlug)`: a second create against an existing slug is a
 * no-op that returns the existing record without emitting a duplicate event.
 *
 * **Idempotency design — "no-op + return existing"**
 *
 * The capability spec calls this handler "idempotent on (tenantId,
 * repoSlug)". Two designs satisfy that:
 *
 *   1. **No-op + return existing**: short-circuit on a slug match, return
 *      the existing `repoId`, emit no new event. Mirrors `signup-submit`
 *      (`preexisting: true`) where re-submitting the same email returns
 *      the same signup row.
 *   2. **Always emit**: emit `Repository.Created` even on a redundant
 *      call; the projection sees a duplicate write and treats it as a
 *      no-op.
 *
 * We picked **(1)**. Rationale:
 *
 *   - The event is the audit-of-record for "this repo started existing."
 *     A redundant emit would write a duplicate audit row that's not the
 *     truth (the repo already started existing earlier).
 *   - Tag-based cache invalidation only fires when an event is emitted.
 *     A redundant `Tenant:${tenantId}` purge for an unchanged tenant is
 *     wasted work.
 *   - The atlasctl push flow always emits `Repository.Upload` afterwards,
 *     and that event still flushes `Tenant:${tenantId}`, so the read-side
 *     stays correct.
 *   - The projection rebuild path (`repository-summary.ts`) tolerates a
 *     `Repository.Created` for a row it already has (idempotent upsert),
 *     so option (2) would also be safe — but option (1) keeps the event
 *     stream cleaner.
 *
 * Cache-invalidation tags emitted on a fresh create:
 *   `['Tenant:${tenantId}', 'Repository:${repoId}']`
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore, RepositoryStore } from '@atlas/ports';
import { newEventId, newRepoId } from '../ids.ts';
import {
  REPOSITORY_CREATED_EVENT_TYPE,
  REPOSITORY_CREATED_SCHEMA_ID,
  REPOSITORY_CREATED_SCHEMA_VERSION,
} from '../events.ts';
import type {
  RepositoryCreateCommand,
  RepositoryCreateResult,
  RepositoryCreatedPayload,
} from '../types.ts';

export async function handleRepositoryCreate(
  cmd: RepositoryCreateCommand,
  repositories: RepositoryStore,
  eventStore: EventStore,
): Promise<RepositoryCreateResult> {
  // Idempotent short-circuit. If a row already exists for
  // (tenantId, repoSlug) we return it untouched and emit no new event.
  const existing = await repositories.getBySlug(cmd.tenantId, cmd.repoSlug);
  if (existing) {
    return {
      envelope: null,
      repository: existing,
      preexisting: true,
    };
  }

  const repoId = newRepoId();
  const occurredAt = new Date().toISOString();
  const description = cmd.description ?? null;

  // Persist the row first so a crash between `create` and `eventStore.append`
  // is recoverable: a retry will see the row via `getBySlug` and return the
  // existing record (no duplicate event emitted). The dispatcher rebuild
  // path can also rebuild the projection from the event alone (I12), so the
  // ordering here is a minor optimization, not a correctness requirement.
  await repositories.create(cmd.tenantId, {
    repoId,
    repoSlug: cmd.repoSlug,
    name: cmd.name,
    ...(cmd.description !== undefined ? { description: cmd.description } : {}),
    createdBy: cmd.principalId,
  });

  const repository = {
    repoId,
    repoSlug: cmd.repoSlug,
    name: cmd.name,
    description,
    createdAt: occurredAt,
    createdBy: cmd.principalId,
  };

  const payload: RepositoryCreatedPayload = {
    repoId,
    repoSlug: cmd.repoSlug,
    name: cmd.name,
    description,
  };

  const envelope: EventEnvelope<
    'Repository.Created',
    RepositoryCreatedPayload
  > = {
    eventId: newEventId(),
    eventType: REPOSITORY_CREATED_EVENT_TYPE,
    schemaId: REPOSITORY_CREATED_SCHEMA_ID,
    schemaVersion: REPOSITORY_CREATED_SCHEMA_VERSION,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `repository.create.${cmd.tenantId}.${cmd.repoSlug}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `Repository:${repoId}`,
    ],
    payload,
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return {
    envelope,
    repository,
    preexisting: false,
  };
}
