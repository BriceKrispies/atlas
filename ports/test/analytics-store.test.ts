/**
 * Failing test for the missing `AnalyticsStore` TS port.
 *
 * The Rust runtime defines an `AnalyticsStore` trait
 * (`crates/runtime/src/ports.rs`, Invariant I11):
 *
 *     #[async_trait]
 *     pub trait AnalyticsStore: Send + Sync {
 *         async fn record(&self, event: &AnalyticsEvent) -> PortResult<()>;
 *         async fn query(
 *             &self,
 *             event_type: &str,
 *             tenant_id: &str,
 *             time_range: (i64, i64),
 *             bucket_size_secs: u64,
 *             dimensions: &[String],
 *         ) -> PortResult<Vec<TimeBucket>>;
 *     }
 *
 * The TypeScript port surface in `@atlas/ports` does NOT expose a parallel
 * `AnalyticsStore` interface. This test pins the desired TS shape:
 *
 *   - `AnalyticsStore` interface with `record(event)` + `query(filter)`
 *   - `AnalyticsEvent` shape: tenantId, eventType, occurredAt, principalId?,
 *     properties: Record<string, unknown>
 *   - `AnalyticsQuery` shape: tenantId, eventType?, from?, to?, limit?
 *
 * Expected red-phase failure: TS compile error
 *   "Module '"@atlas/ports"' has no exported member 'AnalyticsStore'."
 */

import { describe, test, expect, expectTypeOf } from 'vitest';
import type {
  AnalyticsStore,
  AnalyticsEvent,
  AnalyticsQuery,
} from '@atlas/ports';

/**
 * Stub implementation that satisfies the desired AnalyticsStore contract.
 * If the interface compiles with these exact method shapes, we have proof
 * the port surface is what we want.
 */
class StubAnalyticsStore implements AnalyticsStore {
  private readonly events: AnalyticsEvent[] = [];

  async record(event: AnalyticsEvent): Promise<void> {
    this.events.push(event);
  }

  async query(filter: AnalyticsQuery): Promise<AnalyticsEvent[]> {
    return this.events.filter((e) => {
      if (e.tenantId !== filter.tenantId) return false;
      if (filter.eventType !== undefined && e.eventType !== filter.eventType) {
        return false;
      }
      if (filter.from !== undefined && e.occurredAt < filter.from) return false;
      if (filter.to !== undefined && e.occurredAt > filter.to) return false;
      return true;
    }).slice(0, filter.limit ?? Number.POSITIVE_INFINITY);
  }
}

describe('AnalyticsStore port (TS surface)', () => {
  test('interface exposes record(event) and query(filter) with correct types', () => {
    expectTypeOf<AnalyticsStore>().toHaveProperty('record');
    expectTypeOf<AnalyticsStore>().toHaveProperty('query');

    expectTypeOf<AnalyticsStore['record']>()
      .parameter(0)
      .toEqualTypeOf<AnalyticsEvent>();
    expectTypeOf<AnalyticsStore['record']>()
      .returns.toEqualTypeOf<Promise<void>>();

    expectTypeOf<AnalyticsStore['query']>()
      .parameter(0)
      .toEqualTypeOf<AnalyticsQuery>();
    expectTypeOf<AnalyticsStore['query']>()
      .returns.toEqualTypeOf<Promise<AnalyticsEvent[]>>();
  });

  test('AnalyticsEvent has the documented camelCase shape', () => {
    const event: AnalyticsEvent = {
      tenantId: 'tenant-itest',
      eventType: 'ContentPages.page_created',
      occurredAt: '2026-04-30T00:00:00Z',
      principalId: 'user-1',
      properties: { pageId: 'page-1', slug: '/welcome' },
    };

    // principalId is optional — the type must permit omitting it
    const eventWithoutPrincipal: AnalyticsEvent = {
      tenantId: 'tenant-itest',
      eventType: 'ContentPages.page_created',
      occurredAt: '2026-04-30T00:00:00Z',
      properties: {},
    };

    expectTypeOf(event.properties).toEqualTypeOf<Record<string, unknown>>();
    expect(event.tenantId).toBe('tenant-itest');
    expect(eventWithoutPrincipal.principalId).toBeUndefined();
  });

  test('AnalyticsQuery only requires tenantId; everything else optional', () => {
    const minimal: AnalyticsQuery = { tenantId: 'tenant-itest' };
    const full: AnalyticsQuery = {
      tenantId: 'tenant-itest',
      eventType: 'ContentPages.page_created',
      from: '2026-04-01T00:00:00Z',
      to: '2026-04-30T23:59:59Z',
      limit: 50,
    };
    expect(minimal.tenantId).toBe('tenant-itest');
    expect(full.limit).toBe(50);
  });

  test('record then query round-trips events filtered by tenant + eventType', async () => {
    const store: AnalyticsStore = new StubAnalyticsStore();

    await store.record({
      tenantId: 'tenant-a',
      eventType: 'ContentPages.page_created',
      occurredAt: '2026-04-30T00:00:00Z',
      principalId: 'user-1',
      properties: { pageId: 'page-1' },
    });
    await store.record({
      tenantId: 'tenant-a',
      eventType: 'ContentPages.page_published',
      occurredAt: '2026-04-30T00:01:00Z',
      properties: { pageId: 'page-1' },
    });
    await store.record({
      tenantId: 'tenant-b',
      eventType: 'ContentPages.page_created',
      occurredAt: '2026-04-30T00:02:00Z',
      properties: { pageId: 'page-99' },
    });

    const tenantAOnly = await store.query({ tenantId: 'tenant-a' });
    expect(tenantAOnly).toHaveLength(2);
    expect(tenantAOnly.every((e) => e.tenantId === 'tenant-a')).toBe(true);

    const created = await store.query({
      tenantId: 'tenant-a',
      eventType: 'ContentPages.page_created',
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.properties).toEqual({ pageId: 'page-1' });

    const tenantBLeak = await store.query({
      tenantId: 'tenant-a',
      eventType: 'ContentPages.page_created',
      // tenant-b's event must NEVER appear when querying tenant-a (I7)
    });
    expect(tenantBLeak.some((e) => e.tenantId !== 'tenant-a')).toBe(false);
  });

  test('query honours from/to time window and limit', async () => {
    const store: AnalyticsStore = new StubAnalyticsStore();
    const tenantId = 'tenant-itest';

    for (const occurredAt of [
      '2026-04-01T00:00:00Z',
      '2026-04-15T00:00:00Z',
      '2026-04-29T00:00:00Z',
    ]) {
      await store.record({
        tenantId,
        eventType: 'X.y',
        occurredAt,
        properties: {},
      });
    }

    const windowed = await store.query({
      tenantId,
      from: '2026-04-10T00:00:00Z',
      to: '2026-04-20T00:00:00Z',
    });
    expect(windowed).toHaveLength(1);
    expect(windowed[0]?.occurredAt).toBe('2026-04-15T00:00:00Z');

    const limited = await store.query({ tenantId, limit: 2 });
    expect(limited).toHaveLength(2);
  });
});
