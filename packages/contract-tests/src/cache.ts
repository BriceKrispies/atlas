import { describe } from 'vitest';
import type { Cache } from '@atlas/ports';

export function cacheContract(_makeCache: () => Promise<Cache>): void {
  describe.skip('Cache contract (skeleton — bodies arrive in Chunk 2)', () => {
    // get returns null for missing
    // set then get round-trips
    // ttl expiry returns null
    // invalidateByTags removes all matching keys
    // invalidateByKey is idempotent
  });
}
