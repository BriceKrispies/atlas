import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore } from '@atlas/ports';
import type { PageDocument, PageStatus } from '../types.ts';
import { newEventId } from '../ids.ts';

export interface PageCreateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  pageId: string;
  title: string;
  slug: string;
  status?: PageStatus;
  content?: string;
  authorId?: string | null;
  templateId?: string;
  templateVersion?: string;
  pluginRef?: string;
}

export interface PageCreateResult {
  envelope: EventEnvelope;
  document: PageDocument;
}

/**
 * `ContentPages.Page.Create` handler.
 *
 * Builds the canonical PageDocument, appends a `ContentPages.PageCreated`
 * event whose payload IS the document (so the dispatcher can persist it
 * and rebuild projections without an extra read), and returns both.
 *
 * Cache-invalidation tags: `Tenant:{tenantId}` + `Page:{pageId}` —
 * matches the Rust counterpart in `crates/ingress/src/main.rs::handle_intent`.
 */
export async function handlePageCreate(
  cmd: PageCreateCommand,
  eventStore: EventStore,
): Promise<PageCreateResult> {
  const occurredAt = new Date().toISOString();

  const document: PageDocument = {
    pageId: cmd.pageId,
    tenantId: cmd.tenantId,
    title: cmd.title,
    slug: cmd.slug,
    status: cmd.status ?? 'draft',
    createdAt: occurredAt,
    updatedAt: occurredAt,
    ...(cmd.content !== undefined ? { content: cmd.content } : {}),
    ...(cmd.authorId !== undefined ? { authorId: cmd.authorId } : {}),
    ...(cmd.templateId !== undefined ? { templateId: cmd.templateId } : {}),
    ...(cmd.templateVersion !== undefined
      ? { templateVersion: cmd.templateVersion }
      : {}),
    ...(cmd.pluginRef !== undefined ? { pluginRef: cmd.pluginRef } : {}),
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'ContentPages.PageCreated',
    schemaId: 'domain.contentpages.page.created.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `contentpages.page.create.${cmd.tenantId}.${cmd.pageId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `Page:${cmd.pageId}`],
    payload: { document },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored;

  return { envelope, document };
}
