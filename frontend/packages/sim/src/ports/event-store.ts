import type { Db } from './db.ts';
import type { EventEnvelope } from '../types.ts';

export class EventStorePort {
  constructor(private readonly db: Db) {}

  async append(envelope: EventEnvelope): Promise<string> {
    const tx = this.db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    const idx = store.index('by_idempotency_key');
    const existing = await idx.get(envelope.idempotencyKey);
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
    if (tenantId === '*') {
      return this.db.getAll('events');
    }
    return this.db.getAllFromIndex('events', 'by_tenant', tenantId);
  }
}
