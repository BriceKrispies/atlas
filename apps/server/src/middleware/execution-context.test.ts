/**
 * Wiring tests for the execution-context middleware + per-request ctx.
 *
 * Asserts:
 *   - executionContextMiddleware builds a ctx with a correlationId
 *   - inbound X-Correlation-Id is preserved
 *   - missing inbound is generated
 *   - response carries X-Correlation-Id
 *   - ctx is anonymous-principal until principal middleware upgrades it
 *   - ctx.tenantId defaults to config.tenantId pre-auth
 *   - logs from ctx.logger include the request's correlationId
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  CollectorSink,
  InMemoryLevelController,
  LogPipeline,
} from '@atlas/logging';
import type { LogEvent } from '@atlas/logging';
import { executionContextMiddleware } from './execution-context.ts';
import type { AppState } from '../bootstrap.ts';
import type { ServerVariables } from './principal.ts';

interface TestRig {
  app: Hono<{ Variables: ServerVariables }>;
  collector: CollectorSink;
  pipeline: LogPipeline;
}

function makeRig(): TestRig {
  const collector = new CollectorSink();
  const pipeline = new LogPipeline(
    [collector],
    new InMemoryLevelController('debug'),
  );
  // Cast to AppState — the middleware reads only logPipeline + config.
  const state = {
    logPipeline: pipeline,
    config: { tenantId: 'dev-tenant', environment: 'test' },
  } as unknown as AppState;

  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('*', executionContextMiddleware(state));
  return { app, collector, pipeline };
}

describe('executionContextMiddleware', () => {
  it('builds a ctx with mint-fresh correlationId when no header inbound', async () => {
    const { app, collector } = makeRig();
    app.get('/probe', (c) => {
      const ctx = c.get('ctx');
      ctx.logger.info('probe received', { event: 'Test.Probe' });
      return c.text('ok');
    });

    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    expect(collector.events).toHaveLength(1);
    const e = collector.events[0]!;
    expect(e.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // Response carries it back.
    expect(res.headers.get('x-correlation-id')).toBe(e.correlationId);
  });

  it('preserves a valid inbound X-Correlation-Id', async () => {
    const { app, collector } = makeRig();
    app.get('/probe', (c) => {
      c.get('ctx').logger.info('probe', { event: 'Test.Probe' });
      return c.text('ok');
    });
    const res = await app.request('/probe', {
      headers: { 'X-Correlation-Id': 'corr-fixed-1' },
    });
    expect(res.status).toBe(200);
    expect(collector.events[0]!.correlationId).toBe('corr-fixed-1');
    expect(res.headers.get('x-correlation-id')).toBe('corr-fixed-1');
  });

  it('rejects malformed inbound id and mints a fresh one', async () => {
    const { app, collector } = makeRig();
    app.get('/probe', (c) => {
      c.get('ctx').logger.info('probe', { event: 'Test.Probe' });
      return c.text('ok');
    });
    // The existing correlationIdFor accepts any non-empty string. The
    // sanitization happens inside createRootContext via
    // sanitizeIncomingCorrelationId. Embedded newlines would never be
    // sent via real HTTP (HTTP/1.1 strips control chars), but the
    // sanitizer is the belt-and-suspenders layer — verify it.
    const res = await app.request('/probe', {
      headers: { 'X-Correlation-Id': 'has spaces and bad chars!@#' },
    });
    expect(res.status).toBe(200);
    // Bad chars → sanitizer rejects → fresh UUID minted.
    const id = collector.events[0]!.correlationId;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('ctx is anonymous-principal pre-auth, with default tenant', async () => {
    const { app, collector } = makeRig();
    app.get('/probe', (c) => {
      c.get('ctx').logger.info('hi', { event: 'Test.Probe' });
      return c.text('ok');
    });
    await app.request('/probe');
    const e = collector.events[0]!;
    expect(e.principalId).toBe('anonymous');
    expect(e.tenantId).toBe('dev-tenant');
  });

  it('multiple log lines from the same request share the same correlationId', async () => {
    const { app, collector } = makeRig();
    app.get('/probe', (c) => {
      const ctx = c.get('ctx');
      ctx.logger.info('one', { event: 'Test.One' });
      ctx.logger.warn('two', { event: 'Test.Two', cause: 'just a warn' } as never);
      ctx.logger.error('three', {
        event: 'Test.Three',
        error: { code: 'X', message: 'y' },
      });
      return c.text('ok');
    });
    await app.request('/probe', { headers: { 'X-Correlation-Id': 'fixed' } });
    expect(collector.events.length).toBe(3);
    for (const e of collector.events) {
      expect(e.correlationId).toBe('fixed');
    }
  });

  it('different requests get different correlationIds', async () => {
    const { app, collector } = makeRig();
    app.get('/probe', (c) => {
      c.get('ctx').logger.info('hi', { event: 'Test.Probe' });
      return c.text('ok');
    });
    await app.request('/probe');
    await app.request('/probe');
    expect(collector.events).toHaveLength(2);
    const ids = collector.events.map((e: LogEvent) => e.correlationId);
    expect(new Set(ids).size).toBe(2);
  });

  it('every emitted event carries a fresh requestId per request', async () => {
    const { app, collector } = makeRig();
    app.get('/probe', (c) => {
      c.get('ctx').logger.info('hi', { event: 'Test.Probe' });
      return c.text('ok');
    });
    await app.request('/probe');
    await app.request('/probe');
    const requestIds = collector.events.map((e) => e.requestId).filter(Boolean);
    expect(requestIds).toHaveLength(2);
    expect(new Set(requestIds).size).toBe(2);
  });
});
