/**
 * Integration tests for GET /api/v1/events.
 *
 * Exercises the wired-up Hono app end-to-end:
 *   - subscribe via the route handler (X-Debug-Principal authn)
 *   - publish through the broadcast channel
 *   - assert the SSE wire format + tenant filter behaviour
 *
 * The `submitIntent` pipeline is NOT exercised here — that path needs
 * Postgres pools we don't want to spin up in a unit test. The dispatcher
 * → broadcast wiring is verified by publishing directly to the broadcast,
 * which is the same surface the production dispatcher targets.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppState } from '../bootstrap.ts';
import { ServerEventBroadcast } from '../events/broadcast.ts';
import { serverEventDispatcher } from '../events/dispatcher.ts';
import { eventsRoutes } from './events.ts';
import { principalMiddleware, type ServerVariables } from '../middleware/principal.ts';
import { executionContextMiddleware } from '../middleware/execution-context.ts';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { EventEnvelope } from '@atlas/platform-core';
import { buildFakeAppState } from '../../test/lib/factories.ts';

/**
 * Build an `AppState` for the events SSE route test. We lean on
 * `buildFakeAppState` for the standard fields (config, log pipeline,
 * throw-on-access proxies for everything the route doesn't read) and
 * override `serverEvents` with a real `ServerEventBroadcast` because
 * the route subscribes to it for fan-out.
 */
function makeState(broadcast: ServerEventBroadcast): AppState {
  const { state } = buildFakeAppState({ tenantId: 'default-tenant' });
  // AppState fields are `readonly`; rebuild a new shallow copy with
  // `serverEvents` overridden. Spreading preserves the typed proxies
  // installed by `buildFakeAppState` for the unused adapter fields.
  return { ...state, serverEvents: broadcast };
}

function buildApp(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('*', executionContextMiddleware(state));
  app.use('*', principalMiddleware(state));
  app.route('/', eventsRoutes(state));
  return app;
}

/**
 * Read SSE frames from the response body and resolve once `expected`
 * data frames have arrived (or `timeoutMs` elapses). Comment frames
 * (lines starting with `:`) are skipped — they're just keepalives.
 */
async function readFrames(
  res: Response,
  expected: number,
  timeoutMs = 1000,
): Promise<Array<{ event: string; data: string; id: string }>> {
  const reader = assertDefined(
    res.body,
    'SSE response must have a body to stream',
  ).getReader();
  const decoder = new TextDecoder();
  const frames: Array<{ event: string; data: string; id: string }> = [];
  let buffer = '';
  const start = Date.now();

  while (frames.length < expected && Date.now() - start < timeoutMs) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), 100),
      ),
    ]);
    if (done) break;
    if (!value) continue;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (raw.startsWith(':') || raw.length === 0) continue; // keepalive / blank
      const parsed: { event: string; data: string; id: string } = {
        event: '',
        data: '',
        id: '',
      };
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) parsed.event = line.slice(7);
        else if (line.startsWith('data: ')) parsed.data = line.slice(6);
        else if (line.startsWith('id: ')) parsed.id = line.slice(4);
      }
      frames.push(parsed);
    }
  }

  // Best-effort cleanup so the route handler's iterator can exit.
  try {
    await reader.cancel();
  } catch {
    /* already closed */
  }
  return frames;
}

/**
 * Parse an SSE `data:` payload (`JSON.parse` returns `any`) and narrow to
 * `Record<string, unknown>` via a runtime check. Tests then index by
 * string key without further casts — each `expect(data[key])` reads an
 * `unknown` slot, which is what the assertions consume.
 */
function parseDataObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`expected JSON object frame, got ${typeof parsed}`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

describe('GET /api/v1/events', () => {
  let broadcast: ServerEventBroadcast;
  let app: Hono<{ Variables: ServerVariables }>;

  beforeEach(() => {
    broadcast = new ServerEventBroadcast(64);
    app = buildApp(makeState(broadcast));
  });

  test('rejects unauthenticated requests', async () => {
    const res = await app.request('/api/v1/events');
    // No principal middleware match → 401 from principal middleware.
    expect(res.status).toBe(401);
  });

  test('streams a published event in SSE wire format', async () => {
    // Open the SSE connection.
    const responsePromise = app.request('/api/v1/events', {
      headers: { 'X-Debug-Principal': 'user:alice:t1' },
    });
    const res = await responsePromise;
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type') ?? '').toContain('text/event-stream');

    // Give the route handler a tick to register its subscriber, then publish.
    await new Promise((r) => setTimeout(r, 20));
    broadcast.publish({
      eventType: 'projection.updated',
      tenantId: 't1',
      resourceType: 'page',
      resourceId: 'page-42',
      correlationId: 'corr-xyz',
      occurredAt: '2026-05-01T00:00:00Z',
    });

    const frames = await readFrames(res, 1);
    const frame = frames[0];
    expect(frame).toBeDefined();
    if (!frame) throw new Error('unreachable');
    expect(frame.event).toBe('projection.updated');
    expect(frame.id).toBe('1');
    const data = parseDataObject(frame.data);
    expect(data['eventType']).toBe('projection.updated');
    expect(data['resourceType']).toBe('page');
    expect(data['resourceId']).toBe('page-42');
    expect(data['correlationId']).toBe('corr-xyz');
    // tenantId MUST NOT be on the wire — defense in depth.
    expect(data['tenantId']).toBeUndefined();
  });

  test('filters events by the principal tenantId', async () => {
    const res = await app.request('/api/v1/events', {
      headers: { 'X-Debug-Principal': 'user:alice:t1' },
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));
    // Other tenant — must be dropped by the route filter.
    broadcast.publish({
      eventType: 'projection.updated',
      tenantId: 'other-tenant',
      resourceType: 'page',
      resourceId: 'page-other',
      correlationId: 'corr-other',
      occurredAt: '2026-05-01T00:00:00Z',
    });
    // Same tenant — must be delivered.
    broadcast.publish({
      eventType: 'projection.updated',
      tenantId: 't1',
      resourceType: 'page',
      resourceId: 'page-mine',
      correlationId: 'corr-mine',
      occurredAt: '2026-05-01T00:00:00Z',
    });

    const frames = await readFrames(res, 1);
    expect(frames).toHaveLength(1);
    const first = frames[0];
    if (!first) throw new Error('unreachable');
    const data = parseDataObject(first.data);
    expect(data['resourceId']).toBe('page-mine');
  });

  test('multiple concurrent subscribers each receive every event', async () => {
    const r1 = await app.request('/api/v1/events', {
      headers: { 'X-Debug-Principal': 'user:alice:t1' },
    });
    const r2 = await app.request('/api/v1/events', {
      headers: { 'X-Debug-Principal': 'user:bob:t1' },
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));
    expect(broadcast.subscriberCount).toBe(2);

    broadcast.publish({
      eventType: 'cache.invalidated',
      tenantId: 't1',
      resourceType: 'cache',
      resourceId: 'tag:foo',
      correlationId: 'corr-1',
      occurredAt: '2026-05-01T00:00:00Z',
    });

    const [f1, f2] = await Promise.all([readFrames(r1, 1), readFrames(r2, 1)]);
    expect(f1[0]?.event).toBe('cache.invalidated');
    expect(f2[0]?.event).toBe('cache.invalidated');
  });
});

describe('serverEventDispatcher', () => {
  test('maps ContentPages.PageCreateRequested to projection.updated', async () => {
    const broadcast = new ServerEventBroadcast(8);
    const dispatch = serverEventDispatcher(broadcast);
    const { events, unsubscribe } = broadcast.subscribe();

    const envelope: EventEnvelope = {
      eventId: 'evt-1',
      eventType: 'ContentPages.PageCreateRequested',
      schemaId: 'ui.contentpages.page.create.v1',
      schemaVersion: 1,
      occurredAt: '2026-05-01T00:00:00Z',
      tenantId: 't1',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      causationId: null,
      principalId: 'user-1',
      userId: 'user-1',
      cacheInvalidationTags: null,
      payload: { pageId: 'page-7', title: 'T', slug: 's', actionId: 'x', resourceType: 'page' },
    };
    await dispatch(envelope);

    const next = await events.next();
    expect(next.done).toBe(false);
    expect(next.value).toMatchObject({
      eventType: 'projection.updated',
      tenantId: 't1',
      resourceType: 'page',
      resourceId: 'page-7',
      correlationId: 'corr-1',
    });
    unsubscribe();
  });

  test('emits cache.invalidated when cacheInvalidationTags is non-empty', async () => {
    const broadcast = new ServerEventBroadcast(8);
    const dispatch = serverEventDispatcher(broadcast);
    const { events, unsubscribe } = broadcast.subscribe();

    const envelope: EventEnvelope = {
      eventId: 'evt-2',
      eventType: 'Catalog.SeedPackage.Apply',
      schemaId: 'catalog.seed_package.apply.v1',
      schemaVersion: 1,
      occurredAt: '2026-05-01T00:00:00Z',
      tenantId: 't1',
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
      causationId: null,
      principalId: 'user-1',
      userId: 'user-1',
      cacheInvalidationTags: ['Tenant:t1', 'Catalog'],
      payload: {},
    };
    await dispatch(envelope);

    const next = await events.next();
    expect(next.value).toMatchObject({
      eventType: 'cache.invalidated',
      resourceType: 'cache',
      resourceId: 'Tenant:t1,Catalog',
    });
    unsubscribe();
  });
});
