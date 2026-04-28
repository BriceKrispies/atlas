import { describe } from 'vitest';
import type { EventStore } from '@atlas/ports';

// Skeleton — Chunk 2 fills these out. The factory signature is the contract:
// every adapter for EventStore must pass this same suite.
export function eventStoreContract(_makeStore: () => Promise<EventStore>): void {
  describe.skip('EventStore contract (skeleton — bodies arrive in Chunk 2)', () => {
    // append returns existing eventId on idempotency-key replay
    // append rejects when tenantId mismatches event envelope
    // readEvents filters by tenant
    // ordering is preserved by occurredAt
    // error shapes are consistent across adapters
  });
}
