import type { CacheSetOptions } from '@atlas/platform-core';
import type { Cache } from '@atlas/ports';
import type { IdbDb } from './db.ts';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export class IdbCache implements Cache {
  constructor(private readonly db: IdbDb) {}

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

    // Phase 1: collect matching keys under a readonly transaction. Awaiting
    // inside an IDB readwrite transaction is fragile (the transaction can
    // auto-commit if the microtask queue runs dry), and the pattern doesn't
    // translate cleanly to Postgres. Splitting the read and the write keeps
    // each phase short-lived and atomic per phase.
    const matched = new Set<string>();
    {
      const ro = this.db.transaction('cache', 'readonly');
      const idx = ro.objectStore('cache').index('by_tag');
      for (const tag of tags) {
        let cursor = await idx.openCursor(IDBKeyRange.only(tag));
        while (cursor) {
          matched.add(cursor.value.cacheKey);
          cursor = await cursor.continue();
        }
      }
      await ro.done;
    }

    if (matched.size === 0) return 0;

    // Phase 2: delete the collected keys. Each delete is conditional on the
    // row still existing — under concurrent invalidation the second caller
    // must not double-count rows the first caller already removed. We count
    // only the deletes that actually removed an existing row.
    let deleted = 0;
    const rw = this.db.transaction('cache', 'readwrite');
    const store = rw.objectStore('cache');
    for (const key of matched) {
      const existing = await store.get(key);
      if (existing !== undefined) {
        await store.delete(key);
        deleted++;
      }
    }
    await rw.done;
    return deleted;
  }
}
