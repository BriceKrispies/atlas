/**
 * BDD world — the per-scenario state passed between steps.
 *
 * One World instance is constructed at the start of EACH scenario. Steps
 * mutate it as the scenario walks through Given/When/Then. After the
 * scenario, the World is discarded — no leakage between scenarios.
 *
 * The in-memory adapter shims are imported from
 * `../lib/fixtures.ts` (the canonical identity-test in-memory store
 * implementations). Earlier revisions duplicated the shims inline to
 * keep this BDD harness self-contained; W4.19 consolidated them so
 * tests can't drift apart from each other.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type {
  InviteTokenDocument,
  UserDocument,
  IdentityError,
} from '@atlas/identity';
import { dispatchIdentityEvent } from '@atlas/identity';
import {
  InMemoryEventStore,
  InMemoryEntityStore,
  InMemoryRelationStore,
} from '../lib/fixtures.ts';

export { InMemoryEventStore, InMemoryEntityStore, InMemoryRelationStore };

/**
 * Per-scenario state. Each step reads/writes through here. Properties
 * are intentionally optional — early steps populate them.
 */
export interface BddWorld {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  /** Tenant the scenario operates on. Set by the Background "a tenant ..." step. */
  tenantId: string;
  /** Plaintext invite token, surfaced once at issue, kept for redemption. */
  pendingInviteToken?: string;
  /** Persisted invite document, for asserting consumed-status etc. */
  pendingInvite?: InviteTokenDocument;
  /** User document mutated through the scenario. */
  user?: UserDocument;
  /** The IdentityError (if any) the most recent When-step produced. */
  lastError?: IdentityError;
  /** The most recent EventEnvelope a When-step emitted. */
  lastEnvelope?: EventEnvelope;
}

export function freshWorld(tenantId = 'smb'): BddWorld {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    relations: new InMemoryRelationStore(),
    tenantId,
  };
}

/**
 * Replay the world's emitted events through the identity dispatcher
 * to materialise entity-side state. Handlers emit; the dispatcher
 * persists. Call after any When-step that produces events whose
 * entity-side effects subsequent steps rely on.
 */
export async function dispatchAll(world: BddWorld): Promise<void> {
  for (const e of world.events.events) {
    await dispatchIdentityEvent(e, {
      entities: world.entities,
      relations: world.relations,
    });
  }
}
