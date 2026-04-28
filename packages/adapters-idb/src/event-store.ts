import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore } from '@atlas/ports';
import type { IdbDb } from './db.ts';

export class IdbEventStore implements EventStore {
  constructor(private readonly db: IdbDb) {}

  async append(envelope: EventEnvelope): Promise<string> {
    const tx = this.db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    const idx = store.index('by_tenant_idempotency_key');
    const existing = await idx.get([envelope.tenantId, envelope.idempotencyKey]);
    if (existing) {
      await tx.done;
      return existing.eventId;
    }
    await store.add(envelope);
    await tx.done;
    return envelope.eventId;
  }

  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    const v = await this.db.get('events', eventId);
    return v ?? null;
  }

  async readEvents(tenantId: string): Promise<EventEnvelope[]> {
    const all =
      tenantId === '*'
        ? await this.db.getAll('events')
        : await this.db.getAllFromIndex('events', 'by_tenant', tenantId);
    // Contract: events ordered ascending by occurredAt. ISO-8601 strings
    // sort lexicographically the same as chronologically.
    return all.sort((a, b) => {
      if (a.occurredAt < b.occurredAt) return -1;
      if (a.occurredAt > b.occurredAt) return 1;
      return 0;
    });
  }
}
