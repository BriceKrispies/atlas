import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore } from '@atlas/ports';
import { newEventId } from '../ids.ts';

export interface PageDeleteCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  pageId: string;
}

export interface PageDeleteResult {
  envelope: EventEnvelope;
}

/**
 * `ContentPages.Page.Delete` handler.
 *
 * Emits `ContentPages.PageDeleted`. Cleanup of the document, page list
 * entry, and render-tree projection happens in the dispatcher.
 *
 * Idempotent: deleting a page that doesn't exist still produces an
 * event (the dispatcher's deletes are no-ops on missing keys). This
 * matches the mock backend behaviour and simplifies the admin UX.
 */
export async function handlePageDelete(
  cmd: PageDeleteCommand,
  eventStore: EventStore,
): Promise<PageDeleteResult> {
  const occurredAt = new Date().toISOString();

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'ContentPages.PageDeleted',
    schemaId: 'domain.contentpages.page.deleted.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `contentpages.page.delete.${cmd.tenantId}.${cmd.pageId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `Page:${cmd.pageId}`],
    payload: { pageId: cmd.pageId, tenantId: cmd.tenantId },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored;

  return { envelope };
}
