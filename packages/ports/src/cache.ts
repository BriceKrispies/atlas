import type { CacheSetOptions } from '@atlas/platform-core';

export interface Cache {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, opts: CacheSetOptions): Promise<void>;
  invalidateByKey(key: string): Promise<boolean>;
  invalidateByTags(tags: ReadonlyArray<string>): Promise<number>;
}
