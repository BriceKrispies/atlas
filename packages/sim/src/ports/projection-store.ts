import type { Db } from './db.ts';

export class ProjectionStorePort {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<unknown | null> {
    const row = await this.db.get('projections', key);
    return row ? row.jsonValue : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.put('projections', {
      projectionKey: key,
      jsonValue: value,
      updatedAt: Date.now(),
      version: 1,
    });
  }

  async delete(key: string): Promise<boolean> {
    const existing = await this.db.get('projections', key);
    if (!existing) return false;
    await this.db.delete('projections', key);
    return true;
  }
}
