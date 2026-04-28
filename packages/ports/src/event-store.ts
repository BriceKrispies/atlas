import type { EventEnvelope } from '@atlas/platform-core';

export interface EventStore {
  append(envelope: EventEnvelope): Promise<string>;
  getEvent(eventId: string): Promise<EventEnvelope | null>;
  readEvents(tenantId: string): Promise<EventEnvelope[]>;
}
