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
import { CollectorSink, InMemoryLevelController, LogPipeline, MemoryRingBufferSink, } from '@atlas/logging';
import { tenantDocsRoutes, operatorDocsRoutes } from './docs.ts';
import { executionContextMiddleware } from '../middleware/execution-context.ts';
import type { AppState } from '../bootstrap.ts';
import type { ServerVariables } from '../middleware/principal.ts';
function makeApp(opts: {
    principal?: 'anonymous' | 'admin' | 'plain';
} = {}): Hono<{
    Variables: ServerVariables;
}> {
    const levelController = new InMemoryLevelController('info');
    const inspectionSink = new MemoryRingBufferSink({ capacity: 100 });
    const logPipeline = new LogPipeline([new CollectorSink(), inspectionSink], levelController);
    // Test-only AppState stub. Docs routes only read `config`,
    // `logPipeline`, `levelController`, and `inspectionSink`; the full
    // bootstrap surface (pools, adapters, jwks) is not exercised by these
    // smoke tests. The double cast is the canonical pattern for shaping a
    // partial fixture into the production interface at the test boundary.
    // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: test fixture stubs the long-lived AppState; the routes under test only touch the four fields above and the production bootstrap is exercised elsewhere.
    const state = {
        config: { tenantId: 'dev-tenant', environment: 'test' },
        logPipeline,
        levelController,
        inspectionSink,
    } as unknown as AppState;
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    app.use('*', executionContextMiddleware(state));
    app.use('*', async function (c, next) {
        const which = opts.principal ?? 'admin';
        if (which === 'admin') {
            c.set('principal', { principalId: 'u', tenantId: 'dev-tenant', roles: ['admin'] });
        }
        else if (which === 'plain') {
            c.set('principal', { principalId: 'u', tenantId: 'dev-tenant', roles: [] });
        }
        await next();
    });
    app.route('/', tenantDocsRoutes(state));
    app.route('/', operatorDocsRoutes(state));
    return app;
}
describe('tenant docs routes', function () {
    it('GET /openapi.tenant.json returns valid JSON', async function () {
        const app = makeApp();
        const r = await app.request('/openapi.tenant.json');
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toMatch(/application\/json/);
        const body: unknown = await r.json();
        if (body === null || typeof body !== 'object')
            throw new Error('expected JSON object');
        // `Reflect.get` returns `unknown` so the field read doesn't need a
        // structural narrowing cast of `body` itself.
        const openapi: unknown = Reflect.get(body, 'openapi');
        expect(openapi).toBe('3.1.0');
    });
    it('GET /docs returns HTML with Scalar harness', async function () {
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
describe('operator docs routes — admin gate', function () {
    it('rejects non-admin with 403', async function () {
        const app = makeApp({ principal: 'plain' });
        const r1 = await app.request('/admin/openapi.operator.json');
        expect(r1.status).toBe(403);
        const r2 = await app.request('/admin/docs');
        expect(r2.status).toBe(403);
    });
    it('rejects anonymous with 401', async function () {
        const app = makeApp({ principal: 'anonymous' });
        const r1 = await app.request('/admin/openapi.operator.json');
        expect(r1.status).toBe(401);
        const r2 = await app.request('/admin/docs');
        expect(r2.status).toBe(401);
    });
    it('admin gets through', async function () {
        const app = makeApp({ principal: 'admin' });
        const r1 = await app.request('/admin/openapi.operator.json');
        expect(r1.status).toBe(200);
        expect(r1.headers.get('content-type')).toMatch(/application\/json/);
        const r2 = await app.request('/admin/docs');
        expect(r2.status).toBe(200);
        expect(r2.headers.get('content-type')).toMatch(/text\/html/);
    });
    it('operator HTML points at the admin spec URL, not the tenant one', async function () {
        const app = makeApp({ principal: 'admin' });
        const r = await app.request('/admin/docs');
        const html = await r.text();
        expect(html).toContain('data-url="/admin/openapi.operator.json"');
        expect(html).not.toContain('data-url="/openapi.tenant.json"');
    });
});
