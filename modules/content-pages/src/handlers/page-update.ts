import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { ContentPagesError, codes } from '../errors.ts';
import type { PageDocument, PageStatus } from '../types.ts';
import { newEventId } from '../ids.ts';
import { getPageEntity } from '../entities/page.ts';

export interface PageUpdateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  pageId: string;
  title?: string;
  slug?: string;
  status?: PageStatus;
  content?: string;
  templateId?: string;
  templateVersion?: string;
}

export interface PageUpdateResult {
  envelope: EventEnvelope;
  document: PageDocument;
}

/**
 * `ContentPages.Page.Update` handler.
 *
 * Reads the existing document via the `Page` entity, applies partial
 * updates, re-stamps `updatedAt`, and emits a `ContentPages.PageUpdated`
 * event whose payload contains the merged document.
 *
 * Throws `ContentPagesError` (`PAGE_NOT_FOUND`) if the page is missing.
 */
export async function handlePageUpdate(
  cmd: PageUpdateCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<PageUpdateResult> {
  const existing = await getPageEntity(entities, cmd.tenantId, cmd.pageId);
  if (!existing) {
    throw new ContentPagesError(
      codes.PAGE_NOT_FOUND,
      `page not found: ${cmd.pageId}`,
      404,
    );
  }

  const occurredAt = new Date().toISOString();
  const document: PageDocument = {
    ...existing,
    ...(cmd.title !== undefined ? { title: cmd.title } : {}),
    ...(cmd.slug !== undefined ? { slug: cmd.slug } : {}),
    ...(cmd.status !== undefined ? { status: cmd.status } : {}),
    ...(cmd.content !== undefined ? { content: cmd.content } : {}),
    ...(cmd.templateId !== undefined ? { templateId: cmd.templateId } : {}),
    ...(cmd.templateVersion !== undefined
      ? { templateVersion: cmd.templateVersion }
      : {}),
    updatedAt: occurredAt,
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'ContentPages.PageUpdated',
    schemaId: 'domain.contentpages.page.updated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `contentpages.page.update.${cmd.tenantId}.${cmd.pageId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `Page:${cmd.pageId}`],
    payload: { document },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return { envelope, document };
}
