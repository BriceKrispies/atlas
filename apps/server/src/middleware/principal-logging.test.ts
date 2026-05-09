/**
 * Logging-instrumentation tests for the principal middleware.
 *
 * Asserts the boundary log lines added in PR 1:
 *   - Authn.Resolved (debug) fires once per successful auth, with the resolved
 *     principal's tenantId / principalId on the log record.
 *   - Authn.Failed (info) fires when the X-Debug-Principal header is malformed.
 *
 * The full auth surface (JWT, API key, OAuth, impersonation) requires more
 * scaffolding than this slice merits; those paths are exercised end-to-end
 * by the smoke script + Playwright integration spec landed alongside this
 * change.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  CollectorSink,
  InMemoryLevelController,
  LogPipeline,
} from '@atlas/logging';
import type { LogEvent } from '@atlas/logging';
import { principalMiddleware, type ServerVariables } from './principal.ts';
import { executionContextMiddleware } from './execution-context.ts';
import type { AppState } from '../bootstrap.ts';

interface Rig {
  app: Hono<{ Variables: ServerVariables }>;
  collector: CollectorSink;
}

function makeRig(): Rig {
  const collector = new CollectorSink();
  const logPipeline = new LogPipeline(
    [collector],
    new InMemoryLevelController('debug'),
  );
  const state = {
    config: {
      port: 3000,
      controlPlaneDbUrl: 'postgres://unused',
      oidc: { issuerUrl: '', jwksUrl: '', audience: '' },
      testAuth: { enabled: true, debugEndpoints: false },
      tenantId: 'dev-tenant',
      rustLog: '',
      environment: 'test' as const,
      policyEngine: 'stub' as const,
    },
    logPipeline,
    levelController: new InMemoryLevelController('debug'),
    controlPlaneSql: null as never,
    tenantDb: null as never,
    controlPlaneRegistry: null as never,
    jwks: null,
    migratedTenants: new Set<string>(),
    policyEngine: null as never,
    wasmHost: null as never,
  } as unknown as AppState;

  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('*', executionContextMiddleware(state));
  app.use('*', principalMiddleware(state));
  app.get('/echo', (c) => c.json(c.get('principal')));
  return { app, collector };
}

function eventsNamed(c: CollectorSink, name: string): LogEvent[] {
  return c.events.filter((e) => e.eventName === name);
}

describe('principalMiddleware — logging instrumentation', () => {
  it('emits Authn.Resolved on successful X-Debug-Principal auth', async () => {
    const { app, collector } = makeRig();
    const res = await app.request('/echo', {
      headers: { 'X-Debug-Principal': 'user:tester:dev-tenant:admin' },
    });
    expect(res.status).toBe(200);
    const lines = eventsNamed(collector, 'Authn.Resolved');
    expect(lines).toHaveLength(1);
    const e = lines[0]!;
    expect(e.level).toBe('debug');
    expect(e.tenantId).toBe('dev-tenant');
    expect(e.principalId).toBe('tester');
    expect(e.properties).toMatchObject({ roles: 1 });
  });

  it('emits Authn.Failed when X-Debug-Principal is malformed', async () => {
    const { app, collector } = makeRig();
    const res = await app.request('/echo', {
      headers: { 'X-Debug-Principal': 'totally-malformed' },
    });
    expect(res.status).toBe(400);
    const lines = eventsNamed(collector, 'Authn.Failed');
    expect(lines).toHaveLength(1);
    const e = lines[0]!;
    expect(e.level).toBe('info');
    expect(e.properties).toMatchObject({
      code: 'PRINCIPAL_INVALID',
      reason: 'debug-principal-malformed',
    });
  });

  it('emits Authn.Failed when no Authorization header is present', async () => {
    const { app, collector } = makeRig();
    const res = await app.request('/echo');
    expect(res.status).toBe(401);
    const lines = eventsNamed(collector, 'Authn.Failed');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.properties).toMatchObject({
      code: 'PRINCIPAL_INVALID',
      reason: 'missing-or-malformed-authorization-header',
    });
  });

  it('Authn.Resolved correlationId matches Request.Received correlationId', async () => {
    const { app, collector } = makeRig();
    const res = await app.request('/echo', {
      headers: {
        'X-Debug-Principal': 'user:tester:dev-tenant',
        'X-Correlation-Id': 'corr-principal-test',
      },
    });
    expect(res.status).toBe(200);
    const resolved = eventsNamed(collector, 'Authn.Resolved');
    const received = eventsNamed(collector, 'Request.Received');
    expect(resolved).toHaveLength(1);
    expect(received).toHaveLength(1);
    expect(resolved[0]!.correlationId).toBe('corr-principal-test');
    expect(received[0]!.correlationId).toBe('corr-principal-test');
  });
});
