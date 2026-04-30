import type { CatalogStateRecord, CatalogStateStore } from '@atlas/ports';
import type { IdbDb } from './db.ts';

export class IdbCatalogStateStore implements CatalogStateStore {
  constructor(private readonly db: IdbDb) {}

  async get(tenantId: string): Promise<CatalogStateRecord | null> {
    const row = await this.db.get('catalog_state', tenantId);
    return row ?? null;
  }

  async put(record: CatalogStateRecord): Promise<void> {
    await this.db.put('catalog_state', { ...record });
  }
}
