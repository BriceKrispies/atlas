/**
 * I6 — Causation Linkage (property).
 *
 * @spec: specs/architecture.md#i6-causation-linkage
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * Invariant (universally quantified): for every emitted event in a
 * request, `causationId` ∈ the request's event-id set (testing.md §2.2),
 * except the origin event which has `causationId === null`. A causal chain
 * must reference only events that actually exist within the same request —
 * a dangling causationId breaks audit-trail reconstruction (I6).
 *
 * The seam is `adapters.emitChain(store, chain)`: it appends a causal chain
 * (each event names the index of its parent, or null for the origin) and
 * resolves those indices to real eventIds. A correct impl links each child
 * to its parent's actual eventId; a broken one fabricates a causationId
 * pointing at no real event.
 */
import fc from 'fast-check';
import type { EventStore } from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import { runConfig } from './_harness.ts';

/** One node in the causal chain; `parentIndex` is null for the origin. */
export interface ChainNode {
  tenantId: string;
  idempotencyKey: string;
  parentIndex: number | null;
}

export interface I6Adapters {
  makeStore: () => Promise<EventStore>;
  /**
   * Append the chain, resolving each node's parentIndex to the eventId of
   * the already-appended parent. Returns the appended eventIds in order.
   * The correct impl is `linkCausationByParentId`.
   */
  emitChain: (store: EventStore, chain: ChainNode[]) => Promise<string[]>;
}

/** Reference correct linkage — causationId = the parent node's real eventId. */
export async function linkCausationByParentId(
  store: EventStore,
  chain: ChainNode[],
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    const causationId =
      node.parentIndex === null ? null : (ids[node.parentIndex] ?? null);
    const envelope: EventEnvelope = {
      eventId: `evt-chain-${node.tenantId}-${i}-${node.idempotencyKey}`,
      eventType: 'Test.I6.Event',
      schemaId: 'test.i6.v1',
      schemaVersion: 1,
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i % 60)).toISOString(),
      tenantId: node.tenantId,
      correlationId: 'corr-i6',
      idempotencyKey: `${node.idempotencyKey}-${i}`,
      causationId,
      principalId: 'user:test',
      userId: null,
      cacheInvalidationTags: [`Tenant:${node.tenantId}`],
      payload: { i },
    };
    const stored = await store.append(envelope);
    ids.push(stored.eventId);
  }
  return ids;
}

/**
 * A valid causal chain: node i's parent is some index < i (or null for
 * origin), guaranteeing the parent already exists when the child appends.
 */
const chainArb: fc.Arbitrary<ChainNode[]> = fc
  .array(
    fc.record({
      tenantId: fc.constantFrom('tenant-a', 'tenant-b'),
      idempotencyKey: fc.string({ minLength: 1, maxLength: 6 }),
    }),
    { minLength: 1, maxLength: 8 },
  )
  .chain((nodes) =>
    fc.tuple(
      ...nodes.map((n, i) =>
        i === 0
          ? fc.constant({ ...n, parentIndex: null } as ChainNode)
          : fc
              .option(fc.integer({ min: 0, max: i - 1 }), { nil: null })
              .map((p) => ({ ...n, parentIndex: p } as ChainNode)),
      ),
    ),
  )
  .map((tuple) => tuple as ChainNode[]);

export function runProperty(adapters: I6Adapters): Promise<void> {
  return fc.assert(
    fc.asyncProperty(chainArb, async function (chain) {
      const store = await adapters.makeStore();
      const ids = await adapters.emitChain(store, chain);
      const idSet = new Set(ids);

      for (const id of ids) {
        const fetched = await store.getEvent(id);
        if (fetched === null) return false;
        const cause = fetched.causationId;
        // Origin events may have null causationId; non-null causationId
        // MUST reference an event in the request's own id set.
        if (cause !== null && cause !== undefined && !idSet.has(cause)) {
          return false;
        }
      }
      return true;
    }),
    runConfig(),
  );
}
