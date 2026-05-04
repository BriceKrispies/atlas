/**
 * AnalyticsStore port (Invariant I11) — TS surface for the Rust
 * `AnalyticsStore` trait in `crates/runtime/src/ports.rs`.
 *
 * The TS API intentionally diverges from the Rust positional signature:
 * the TS `query` takes a single `AnalyticsQuery` filter object
 * (tenant-scoped by default) and returns the matching events directly.
 * Time bucketing / dimension grouping are not part of this surface yet —
 * callers that need pre-aggregated buckets compose them on top.
 *
 * Tenant isolation (Invariant I7) is enforced by `query`: every query
 * MUST carry a `tenantId`, and implementations MUST NOT return events
 * from other tenants.
 */

import type { AnalyticsEvent } from '@atlas/platform-core';

/** Filter for `AnalyticsStore.query`. Only `tenantId` is required. */
export interface AnalyticsQuery {
  tenantId: string;
  eventType?: string;
  /** Inclusive lower bound on `occurredAt` (ISO-8601 string). */
  from?: string;
  /** Inclusive upper bound on `occurredAt` (ISO-8601 string). */
  to?: string;
  /** Hard cap on returned rows. Implementations MUST honour this. */
  limit?: number;
}

export interface AnalyticsStore {
  /** Append an analytics event to the store. */
  record(event: AnalyticsEvent): Promise<void>;

  /**
   * Return events matching `filter`. Tenant-scoped — events from other
   * tenants MUST NOT appear in the result regardless of other filter
   * fields (Invariant I7).
   */
  query(filter: AnalyticsQuery): Promise<AnalyticsEvent[]>;
}

/**
 * In-memory `AnalyticsStore` adapter. Suitable for tests, dev mode, and
 * the in-process bootstrap path; production deployments wire up a
 * persistent adapter.
 */
export class InMemoryAnalyticsStore implements AnalyticsStore {
  private readonly events: AnalyticsEvent[] = [];

  async record(event: AnalyticsEvent): Promise<void> {
    // Defensive copy — callers mutating their event object after record
    // must not retroactively change what's stored.
    this.events.push({ ...event, properties: { ...event.properties } });
  }

  async query(filter: AnalyticsQuery): Promise<AnalyticsEvent[]> {
    const matched = this.events.filter((e) => {
      if (e.tenantId !== filter.tenantId) return false;
      if (filter.eventType !== undefined && e.eventType !== filter.eventType) {
        return false;
      }
      if (filter.from !== undefined && e.occurredAt < filter.from) return false;
      if (filter.to !== undefined && e.occurredAt > filter.to) return false;
      return true;
    });
    return filter.limit !== undefined ? matched.slice(0, filter.limit) : matched;
  }
}
