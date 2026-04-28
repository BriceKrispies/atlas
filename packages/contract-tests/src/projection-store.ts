import { describe } from 'vitest';
import type { ProjectionStore } from '@atlas/ports';

export function projectionStoreContract(_makeStore: () => Promise<ProjectionStore>): void {
  describe.skip('ProjectionStore contract (skeleton — bodies arrive in Chunk 2)', () => {
    // get returns null for missing key
    // set then get round-trips
    // delete returns false for missing key
    // delete returns true and removes existing key
    // overwrite via set replaces value
  });
}
