/**
 * `composeDispatchers` semantic tests — pinned in Chunk 11 after the
 * 8/9/10 audit flagged the previous short-circuit-on-throw behaviour
 * as a SHOULD-FIX (cross-cutting cache-tag invalidation could miss
 * firing when an upstream projection rebuild threw).
 */

import { describe, it, expect, vi } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import { composeDispatchers } from '../src/dispatcher.ts';

function envelope(): EventEnvelope {
  return {
    eventId: 'evt-1',
    eventType: 'StructuredCatalog.FamilyPublished',
    schemaId: 'catalog.family_published.v1',
    schemaVersion: 1,
    occurredAt: new Date('2026-04-29T00:00:00Z').toISOString(),
    tenantId: 'tenant-itest',
    correlationId: 'corr-1',
    idempotencyKey: 'idem-1',
    causationId: null,
    principalId: 'user-1',
    userId: 'user-1',
    cacheInvalidationTags: ['Tenant:tenant-itest'],
    payload: {},
  };
}

describe('composeDispatchers', () => {
  it('runs every dispatcher in order on the happy path', async () => {
    const calls: string[] = [];
    const dispatch = composeDispatchers(
      async () => {
        calls.push('a');
      },
      async () => {
        calls.push('b');
      },
      async () => {
        calls.push('c');
      },
    );
    await dispatch(envelope());
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('skips null/undefined entries (lets callers conditionally include)', async () => {
    const calls: string[] = [];
    const dispatch = composeDispatchers(
      async () => {
        calls.push('a');
      },
      null,
      undefined,
      async () => {
        calls.push('b');
      },
    );
    await dispatch(envelope());
    expect(calls).toEqual(['a', 'b']);
  });

  it('runs every dispatcher even when an earlier one throws (Chunk 11 semantics)', async () => {
    const calls: string[] = [];
    const dispatch = composeDispatchers(
      async () => {
        calls.push('a');
        throw new Error('a failed');
      },
      async () => {
        calls.push('b');
      },
      async () => {
        calls.push('c');
      },
    );
    await expect(dispatch(envelope())).rejects.toThrow('a failed');
    // Crucially, b and c still ran — this is the cache-tag-flush
    // guarantee the audit asked for.
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('re-throws only the FIRST error when multiple dispatchers fail', async () => {
    const dispatch = composeDispatchers(
      async () => {
        throw new Error('first');
      },
      async () => {
        throw new Error('second');
      },
    );
    await expect(dispatch(envelope())).rejects.toThrow('first');
  });

  it('does not throw if every dispatcher resolves', async () => {
    const dispatch = composeDispatchers(
      async () => {},
      async () => {},
    );
    await expect(dispatch(envelope())).resolves.toBeUndefined();
  });

  it('awaits each dispatcher serially', async () => {
    const ticks: string[] = [];
    const dispatch = composeDispatchers(
      async () => {
        await new Promise((r) => setTimeout(r, 0));
        ticks.push('a-end');
      },
      async () => {
        ticks.push('b-start');
      },
    );
    await dispatch(envelope());
    expect(ticks).toEqual(['a-end', 'b-start']);
  });

  it('passes the same envelope to every dispatcher', async () => {
    const seen: EventEnvelope[] = [];
    const dispatch = composeDispatchers(
      async (e) => {
        seen.push(e);
      },
      async (e) => {
        seen.push(e);
      },
    );
    const env = envelope();
    await dispatch(env);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(env);
    expect(seen[1]).toBe(env);
  });

  it('handles a dispatcher that throws `undefined` (sentinel guard)', async () => {
    // If a dispatcher rejects with literal `undefined`, the composer
    // must still re-throw it — that's why the sentinel symbol exists.
    const spy = vi.fn();
    const undefinedThrower = async (): Promise<void> => {
      // Re-thrown via Promise.reject so we don't trip ESLint's
      // "only throw Error" rule while still exercising the sentinel
      // guard against literal-`undefined` rejections.
      return Promise.reject(undefined);
    };
    const dispatch = composeDispatchers(undefinedThrower, async () => {
      spy();
    });
    await expect(dispatch(envelope())).rejects.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
  });
});
