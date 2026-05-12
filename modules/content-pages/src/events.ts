/**
 * Typed event envelope union for the `ContentPages.*` events the
 * dispatcher persists.
 *
 * Discriminated on `eventType`. Each variant pins the `payload` shape so
 * the dispatcher's `switch` arms get field-level narrowing automatically
 * — no `envelope.payload as Record<string, unknown>` + `document as
 * PageDocument` cast ladder. Membership mirrors `HANDLED_EVENT_TYPES` in
 * `dispatch.ts`; when you add a dispatched event type, add the variant
 * here and extend the switch.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { PageDocument } from './types.ts';

export type ContentPagesPageCreatedEvent = EventEnvelope<
  'ContentPages.PageCreated',
  { document: PageDocument }
>;

export type ContentPagesPageUpdatedEvent = EventEnvelope<
  'ContentPages.PageUpdated',
  { document: PageDocument }
>;

export type ContentPagesPageDeletedEvent = EventEnvelope<
  'ContentPages.PageDeleted',
  { pageId: string }
>;

/** Discriminated union of every event the content-pages dispatcher handles. */
export type ContentPagesEvent =
  | ContentPagesPageCreatedEvent
  | ContentPagesPageUpdatedEvent
  | ContentPagesPageDeletedEvent;

/**
 * Type guard: is the incoming envelope one of the typed content-pages
 * events? Narrows the eventType literal so the dispatcher's `switch`
 * arms can read `envelope.payload.document` / `envelope.payload.pageId`
 * with no casts.
 */
export function isContentPagesEvent(
  envelope: EventEnvelope,
): envelope is ContentPagesEvent {
  return (
    envelope.eventType === 'ContentPages.PageCreated' ||
    envelope.eventType === 'ContentPages.PageUpdated' ||
    envelope.eventType === 'ContentPages.PageDeleted'
  );
}
