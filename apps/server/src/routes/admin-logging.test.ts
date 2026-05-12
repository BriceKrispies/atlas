/**
 * Tests for the admin-logging route surface.
 *
 * Covers:
 *   - admin role gate (401 anonymous, 403 non-admin, 200 admin)
 *   - GET /levels returns the snapshot
 *   - POST /levels/global sets, returns updated snapshot
 *   - POST /levels/global rejects null (cannot clear)
 *   - POST /levels/module/:id sets and clears (null body)
 *   - POST /levels/tenant/:id, /correlation/:id same shape
 *   - GET /correlation/:id/recent returns events from the inspection sink
 *   - invalid level rejected with 400
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  CollectorSink,
  InMemoryLevelController,
  LogPipeline,
  MemoryRingBufferSink,
} from '@atlas/logging';
import type { LogEvent } from '@atlas/logging';
import { adminLoggingRoutes } from './admin-logging.ts';
import { executionContextMiddleware } from '../middleware/execution-context.ts';
import type { AppState } from '../bootstrap.ts';
import type { ServerVariables } from '../middleware/principal.ts';
import { buildFakeAppState } from '../../test/lib/factories.ts';

interface Rig {
  app: Hono<{ Variables: ServerVariables }>;
  inspectionSink: MemoryRingBufferSink;
  levelController: InMemoryLevelController;
}

/**
 * Build a typed `AppState` for the admin-logging route tests. Reuses the
 * shared `buildFakeAppState` factory (which throws-on-access for unwired
 * fields) and overrides the three fields this route actually reads:
 * `logPipeline`, `levelController`, and `inspectionSink`. Earlier code
 * laundered an `{ config, logPipeline, levelController, inspectionSink }`
 * literal through `as unknown as AppState`, which silently hid drift the
 * day AppState grew a new required field.
 */
function buildAdminLoggingState(): {
  state: AppState;
  inspectionSink: MemoryRingBufferSink;
  levelController: InMemoryLevelController;
} {
  const levelController = new InMemoryLevelController('info');
  const inspectionSink = new MemoryRingBufferSink({ capacity: 100 });
  const logPipeline = new LogPipeline([new CollectorSink(), inspectionSink], levelController);
  const fake = buildFakeAppState({ tenantId: 'dev-tenant' });
  const state: AppState = {
    ...fake.state,
    logPipeline,
    levelController,
    inspectionSink,
  };
  return { state, inspectionSink, levelController };
}

function makeRig(opts: { adminPrincipal?: boolean; principal?: 'anonymous' | 'admin' | 'plain' } = {}): Rig {
  const { state, inspectionSink, levelController } = buildAdminLoggingState();

  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('*', executionContextMiddleware(state));
  // Stub principal middleware: stamp a fake principal based on opts.
  app.use('*', async (c, next) => {
    const which = opts.principal ?? (opts.adminPrincipal ? 'admin' : 'plain');
    if (which === 'anonymous') {
      // do not set principal
    } else if (which === 'admin') {
      c.set('principal', {
        principalId: 'u-admin',
        tenantId: 'dev-tenant',
        roles: ['admin'],
      });
    } else {
      c.set('principal', {
        principalId: 'u-plain',
        tenantId: 'dev-tenant',
        roles: [],
      });
    }
    await next();
  });
  app.route('/', adminLoggingRoutes(state));
  return { app, inspectionSink, levelController };
}

/**
 * Type-guard: narrows `unknown` to a JSON object. Indexing the result is
 * still `unknown` — leaf fields must narrow before use.
 */
function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read the response body as a JSON object. Throws (failing the test loudly)
 * if the body is not a JSON object. Routes the `Promise<any>` produced by
 * `Response.json()` through a single typed boundary so per-call sites don't
 * each need a `(await r.json()) as <Type>` escape-hatch cast.
 */
async function readBodyObject(r: Response): Promise<Record<string, unknown>> {
  const raw: unknown = await r.json();
  if (!isJsonObject(raw)) {
    throw new Error('Test invariant: response body was not a JSON object');
  }
  return raw;
}

function readNumber(v: unknown, label: string): number {
  if (typeof v !== 'number') throw new Error(`Test invariant: ${label} not number`);
  return v;
}

function readString(v: unknown, label: string): string {
  if (typeof v !== 'string') throw new Error(`Test invariant: ${label} not string`);
  return v;
}

function readEvents(v: unknown): LogEvent[] {
  if (!Array.isArray(v)) throw new Error('Test invariant: events not an array');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: array shape narrowed via Array.isArray; the events are produced by MemoryRingBufferSink which only emits LogEvent values, so element shape is contract-pinned.
  return v as LogEvent[];
}

describe('admin-logging route — gate', () => {
  it('rejects anonymous (no principal) with 401', async () => {
    const { app } = makeRig({ principal: 'anonymous' });
    const r = await app.request('/api/v1/admin/logging/levels');
    expect(r.status).toBe(401);
  });

  it('rejects non-admin authenticated with 403', async () => {
    const { app } = makeRig({ principal: 'plain' });
    const r = await app.request('/api/v1/admin/logging/levels');
    expect(r.status).toBe(403);
  });

  it('admin gets through with 200', async () => {
    const { app } = makeRig({ principal: 'admin' });
    const r = await app.request('/api/v1/admin/logging/levels');
    expect(r.status).toBe(200);
  });
});

describe('admin-logging route — levels snapshot', () => {
  it('GET /levels returns the snapshot shape', async () => {
    const { app } = makeRig({ principal: 'admin' });
    const r = await app.request('/api/v1/admin/logging/levels');
    expect(r.status).toBe(200);
    const body = await readBodyObject(r);
    expect(body['default']).toBe('info');
    expect(body['global']).toBe('info');
    expect(body['byModule']).toEqual({});
    expect(body['byTenant']).toEqual({});
    expect(body['byCorrelation']).toEqual({});
  });
});

describe('admin-logging route — set / clear', () => {
  it('POST /levels/global sets the global level', async () => {
    const { app, levelController } = makeRig({ principal: 'admin' });
    const r = await app.request('/api/v1/admin/logging/levels/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'debug' }),
    });
    expect(r.status).toBe(200);
    expect(levelController.snapshot().global).toBe('debug');
  });

  it('POST /levels/global rejects null with 400', async () => {
    const { app } = makeRig({ principal: 'admin' });
    const r = await app.request('/api/v1/admin/logging/levels/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: null }),
    });
    expect(r.status).toBe(400);
  });

  it('POST /levels/global rejects invalid level with 400', async () => {
    const { app } = makeRig({ principal: 'admin' });
    const r = await app.request('/api/v1/admin/logging/levels/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'FATAL' }), // uppercase rejected
    });
    expect(r.status).toBe(400);
  });

  it('POST /levels/module/:id sets, then null clears', async () => {
    const { app, levelController } = makeRig({ principal: 'admin' });
    const setRes = await app.request('/api/v1/admin/logging/levels/module/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'debug' }),
    });
    expect(setRes.status).toBe(200);
    expect(levelController.snapshot().byModule).toEqual({ identity: 'debug' });

    const clearRes = await app.request('/api/v1/admin/logging/levels/module/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: null }),
    });
    expect(clearRes.status).toBe(200);
    expect(levelController.snapshot().byModule).toEqual({});
  });

  it('POST /levels/tenant/:id sets, null clears', async () => {
    const { app, levelController } = makeRig({ principal: 'admin' });
    await app.request('/api/v1/admin/logging/levels/tenant/acme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'warn' }),
    });
    expect(levelController.snapshot().byTenant).toEqual({ acme: 'warn' });
    await app.request('/api/v1/admin/logging/levels/tenant/acme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: null }),
    });
    expect(levelController.snapshot().byTenant).toEqual({});
  });

  it('POST /levels/correlation/:id sets, null clears', async () => {
    const { app, levelController } = makeRig({ principal: 'admin' });
    await app.request('/api/v1/admin/logging/levels/correlation/corr-x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'debug' }),
    });
    expect(levelController.snapshot().byCorrelation).toEqual({ 'corr-x': 'debug' });
    await app.request('/api/v1/admin/logging/levels/correlation/corr-x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: null }),
    });
    expect(levelController.snapshot().byCorrelation).toEqual({});
  });

  it('rejects malformed JSON body with 400', async () => {
    const { app } = makeRig({ principal: 'admin' });
    const r = await app.request('/api/v1/admin/logging/levels/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(r.status).toBe(400);
  });
});

describe('admin-logging route — inspect', () => {
  function makeEvent(correlationId: string, msg: string): LogEvent {
    return {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: msg,
      tenantId: 'dev-tenant',
      principalId: 'u-1',
      correlationId,
      traceId: correlationId,
      spanId: 's',
    };
  }

  it('returns events filtered to the correlationId', async () => {
    const { app, inspectionSink } = makeRig({ principal: 'admin' });
    inspectionSink.write(makeEvent('corr-A', 'one'));
    inspectionSink.write(makeEvent('corr-B', 'other'));
    inspectionSink.write(makeEvent('corr-A', 'two'));

    const r = await app.request('/api/v1/admin/logging/correlation/corr-A/recent');
    expect(r.status).toBe(200);
    const body = await readBodyObject(r);
    expect(readString(body['correlationId'], 'correlationId')).toBe('corr-A');
    expect(readNumber(body['count'], 'count')).toBe(2);
    expect(readEvents(body['events']).map((e) => e.message)).toEqual(['two', 'one']);
  });

  it('honors ?limit', async () => {
    const { app, inspectionSink } = makeRig({ principal: 'admin' });
    for (let i = 0; i < 10; i++) inspectionSink.write(makeEvent('corr-A', `m${i}`));
    const r = await app.request('/api/v1/admin/logging/correlation/corr-A/recent?limit=3');
    const body = await readBodyObject(r);
    expect(readNumber(body['count'], 'count')).toBe(3);
  });

  it('returns empty array when correlationId not seen', async () => {
    const { app } = makeRig({ principal: 'admin' });
    const r = await app.request('/api/v1/admin/logging/correlation/unknown/recent');
    expect(r.status).toBe(200);
    const body = await readBodyObject(r);
    expect(readNumber(body['count'], 'count')).toBe(0);
    expect(readEvents(body['events'])).toEqual([]);
  });
});
