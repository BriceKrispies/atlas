import type { Db } from './db.ts';
import type { CacheSetOptions } from '../types.ts';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export class CachePort {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<unknown | null> {
    const row = await this.db.get('cache', key);
    if (!row) return null;
    if (row.expiresAt > 0 && nowSec() >= row.expiresAt) {
      await this.db.delete('cache', key);
      return null;
    }
    return row.value;
  }

  async set(key: string, value: unknown, opts: CacheSetOptions): Promise<void> {
    const expiresAt = opts.ttlSeconds > 0 ? nowSec() + opts.ttlSeconds : 0;
    await this.db.put('cache', {
      cacheKey: key,
      value,
      tags: [...opts.tags],
      expiresAt,
    });
  }

  async invalidateByKey(key: string): Promise<boolean> {
    const existing = await this.db.get('cache', key);
    if (!existing) return false;
    await this.db.delete('cache', key);
    return true;
  }

  async invalidateByTags(tags: ReadonlyArray<string>): Promise<number> {
    if (tags.length === 0) return 0;
    const matched = new Set<string>();
    const tx = this.db.transaction('cache', 'readwrite');
    const idx = tx.objectStore('cache').index('by_tag');
    for (const tag of tags) {
      let cursor = await idx.openCursor(IDBKeyRange.only(tag));
      while (cursor) {
        matched.add(cursor.value.cacheKey);
        cursor = await cursor.continue();
      }
    }
    for (const key of matched) {
      await tx.objectStore('cache').delete(key);
    }
    await tx.done;
    return matched.size;
  }
}
