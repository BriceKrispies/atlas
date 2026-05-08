/**
 * Smoke tests for the docs routes.
 *
 * Asserts:
 *   - GET /openapi.tenant.json returns the generated spec (JSON)
 *   - GET /docs returns the Scalar HTML harness
 *   - GET /admin/openapi.operator.json gated by admin role
 *   - GET /admin/docs gated by admin role
 *
 * The actual spec content is asserted in packages/openapi tests; this
 * file only verifies the route plumbing.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  CollectorSink,
  InMemoryLevelController,
  LogPipeline,
  MemoryRingBufferSink,
} from '@atlas/logging';
import { tenantDocsRoutes, operatorDocsRoutes } from './docs.ts';
import { executionContextMiddleware } from '../middleware/execution-context.ts';
import type { AppState } from '../bootstrap.ts';
import type { ServerVariables } from '../middleware/principal.ts';

function makeApp(opts: { principal?: 'anonymous' | 'admin' | 'plain' } = {}): Hono<{ Variables: ServerVariables }> {
  const levelController = new InMemoryLevelController('info');
  const inspectionSink = new MemoryRingBufferSink({ capacity: 100 });
  const logPipeline = new LogPipeline([new CollectorSink(), inspectionSink], levelController);
  const state = {
    config: { tenantId: 'dev-tenant', environment: 'test' },
    logPipeline,
    levelController,
    inspectionSink,
  } as unknown as AppState;

  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('*', executionContextMiddleware(state));
  app.use('*', async (c, next) => {
    const which = opts.principal ?? 'admin';
    if (which === 'admin') {
      c.set('principal', { principalId: 'u', tenantId: 'dev-tenant', roles: ['admin'] });
    } else if (which === 'plain') {
      c.set('principal', { principalId: 'u', tenantId: 'dev-tenant', roles: [] });
    }
    await next();
  });
  app.route('/', tenantDocsRoutes(state));
  app.route('/', operatorDocsRoutes(state));
  return app;
}

describe('tenant docs routes', () => {
  it('GET /openapi.tenant.json returns valid JSON', async () => {
    const app = makeApp();
    const r = await app.request('/openapi.tenant.json');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body['openapi']).toBe('3.1.0');
  });

  it('GET /docs returns HTML with Scalar harness', async () => {
    const app = makeApp();
    const r = await app.request('/docs');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    const html = await r.text();
    expect(html).toContain('id="api-reference"');
    expect(html).toContain('data-url="/openapi.tenant.json"');
    expect(html).toContain('@scalar/api-reference');
  });
});

describe('operator docs routes — admin gate', () => {
  it('rejects non-admin with 403', async () => {
    const app = makeApp({ principal: 'plain' });
    const r1 = await app.request('/admin/openapi.operator.json');
    expect(r1.status).toBe(403);
    const r2 = await app.request('/admin/docs');
    expect(r2.status).toBe(403);
  });

  it('rejects anonymous with 401', async () => {
    const app = makeApp({ principal: 'anonymous' });
    const r1 = await app.request('/admin/openapi.operator.json');
    expect(r1.status).toBe(401);
    const r2 = await app.request('/admin/docs');
    expect(r2.status).toBe(401);
  });

  it('admin gets through', async () => {
    const app = makeApp({ principal: 'admin' });
    const r1 = await app.request('/admin/openapi.operator.json');
    expect(r1.status).toBe(200);
    expect(r1.headers.get('content-type')).toMatch(/application\/json/);
    const r2 = await app.request('/admin/docs');
    expect(r2.status).toBe(200);
    expect(r2.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('operator HTML points at the admin spec URL, not the tenant one', async () => {
    const app = makeApp({ principal: 'admin' });
    const r = await app.request('/admin/docs');
    const html = await r.text();
    expect(html).toContain('data-url="/admin/openapi.operator.json"');
    expect(html).not.toContain('data-url="/openapi.tenant.json"');
  });
});
