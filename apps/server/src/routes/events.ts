/**
 * GET /api/v1/events — Server-Sent Events stream.
 *
 * Mirrors `crates/ingress/src/sse.rs`. Subscribes the connection to the
 * process-wide `ServerEventBroadcast` channel, filters by the
 * authenticated principal's `tenantId`, and streams each matching event
 * as an SSE message. Disconnects unsubscribe automatically — the
 * `streamSSE` callback returns when the iterator exits, which fires the
 * subscriber's `unsubscribe()` via the iterator's `return()` hook (or
 * via the explicit `c.req.raw.signal` abort handler we register below).
 *
 * Wire format per message (matches Rust):
 *   event: <eventType>
 *   id: <monotonic per-subscriber counter>
 *   data: { eventType, resourceType, resourceId, correlationId, occurredAt, tags? }
 *
 * Tag filtering: clients may pass `?tags=Tag1,Tag2` to receive only
 * events whose `tags` array overlaps the requested set (i.e. at least
 * one tag matches by strict equality). Empty / missing → no tag filter
 * (backwards-compatible, current behaviour).
 *
 * TODO(phase-5+): wildcard / glob support (`Page:*`, `Tenant:*`). Phase 5
 * is strict equality only — clients enumerate the specific tags they
 * care about. Wildcards introduce match-cost per event per subscriber
 * and want benchmarking before they ship.
 *
 * Reconnection: the browser auto-reconnects on disconnect with
 * `Last-Event-ID`. We accept the header to align with Rust but do
 * nothing useful with it (no replay buffer in v1) — the counter resumes
 * from there for client-side ordering.
 *
 * Keepalives: Hono's `streamSSE` does not auto-emit them; we fire a
 * `: keepalive` comment every 15 seconds (same cadence as
 * `KeepAlive::new().interval(Duration::from_secs(15))` in Rust) to keep
 * proxies from idle-killing the connection.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ServerEvent } from '@atlas/platform-core';
import type { AppState } from '../bootstrap.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

const KEEPALIVE_INTERVAL_MS = 15_000;

export function eventsRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.get('/api/v1/events', (c: AppCtx) => {
    const principal = c.get('principal');
    const tenantId = principal.tenantId;

    // Last-Event-ID is honored only for the id counter; v1 has no replay.
    const lastEventIdHeader = c.req.header('Last-Event-ID') ?? '0';
    const parsed = Number.parseInt(lastEventIdHeader, 10);
    const startCounter = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    // ?tags=Tag1,Tag2 → at-least-one-of (strict equality, no wildcards).
    // Empty/missing → no tag filter (back-compat with the original
    // tenant-only stream).
    const tagsParam = c.req.query('tags') ?? '';
    const requestedTags = tagsParam
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const tagFilter: ReadonlySet<string> | null =
      requestedTags.length > 0 ? new Set(requestedTags) : null;

    return streamSSE(c, async (stream) => {
      const { events, unsubscribe } = state.serverEvents.subscribe();

      // Tie cleanup to the request's abort signal so a hung iterator
      // (no events arriving) still releases its slot when the client
      // disconnects. `streamSSE` also wires its own onAbort but it
      // operates on the writer side; we need the subscriber side too.
      const abort = c.req.raw.signal;
      const onAbort = (): void => {
        unsubscribe();
      };
      if (abort.aborted) {
        unsubscribe();
        return;
      }
      abort.addEventListener('abort', onAbort, { once: true });

      // Periodic keepalive so idle connections don't get reaped by
      // proxies. Hono's stream API doesn't expose a comment helper, so
      // we write the raw `: keepalive\n\n` SSE comment frame.
      const keepalive = setInterval(() => {
        // `stream.write` accepts strings; comment lines (`:` prefix)
        // are valid SSE frames the browser silently discards.
        stream.write(': keepalive\n\n').catch(() => {
          // Write failures usually mean the client is gone — let the
          // iterator loop exit naturally on the next aborted check.
        });
      }, KEEPALIVE_INTERVAL_MS);

      let counter = startCounter;
      try {
        for await (const event of events) {
          // Tenant isolation (Invariant I7 / mirrors Rust SSE filter).
          if (event.tenantId !== tenantId) continue;

          // Tag overlap filter — AND'd with tenant. Strict equality on
          // each tag; if the client asked for tags but the event has
          // none, drop it. Wildcards are NOT supported in phase 5.
          if (tagFilter) {
            const eventTags = event.tags;
            if (!eventTags || eventTags.length === 0) continue;
            let matched = false;
            for (const t of eventTags) {
              if (tagFilter.has(t)) {
                matched = true;
                break;
              }
            }
            if (!matched) continue;
          }

          counter += 1;
          await stream.writeSSE({
            event: event.eventType,
            id: counter.toString(),
            data: serialize(event),
          });
        }
      } finally {
        clearInterval(keepalive);
        abort.removeEventListener('abort', onAbort);
        unsubscribe();
      }
    });
  });

  return app;
}

/**
 * JSON-serialise a `ServerEvent` for the wire, omitting `tenantId` —
 * matches Rust's `#[serde(skip)]` on the same field. Subscribers must
 * not see other tenants' identifiers (defense in depth: the broadcast
 * filter above also enforces this).
 */
function serialize(event: ServerEvent): string {
  // `tags` is included on the wire when present so the client-side
  // refetch path can tag-match identically to the server filter; this
  // matters when a client subscribes broadly and wants per-surface
  // filtering. `tenantId` is omitted (defense in depth — the route
  // filter already enforces tenant isolation).
  return JSON.stringify({
    eventType: event.eventType,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    correlationId: event.correlationId,
    occurredAt: event.occurredAt,
    ...(event.tags && event.tags.length > 0 ? { tags: event.tags } : {}),
  });
}
