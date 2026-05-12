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
import { assertDefined } from '@atlas/test-fixtures/assert';
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
  // The principal middleware + execution-context middleware never exercise
  // the SQL / tenant-db / registry / policy / wasm fields under the
  // X-Debug-Principal + missing-Authorization paths these tests cover —
  // they short-circuit before touching them. Building real Postgres pools,
  // an entity-type registry, and a WASM host here would dwarf the
  // surface-under-test for zero coverage gain. The fields are present at
  // runtime because `state` is shared with downstream code paths that
  // would touch them; the boundary cast below scopes that compromise to a
  // single annotated line. Full AppState wiring is exercised in
  // apps/server/test/integration/.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast -- boundary: principal-middleware test rig; the auth paths under test (debug-principal accept + missing-Authorization reject) never reach the SQL / tenant-db / registry fields, so we stub the AppState surface the middleware actually touches and cast through `unknown` once.
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
    jwks: null,
    migratedTenants: new Set<string>(),
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
    const e = assertDefined(lines[0], 'Authn.Resolved log event present after length check');
    expect(e.level).toBe('debug');
    expect(e.tenantId).toBe('dev-tenant');
    expect(e.principalId).toBe('tester');
    expect(e.properties).toMatchObject({ roles: 1 });
    expect(e.properties).not.toHaveProperty('principalType');
  });

  it('emits Authn.Failed when X-Debug-Principal is malformed', async () => {
    const { app, collector } = makeRig();
    const res = await app.request('/echo', {
      headers: { 'X-Debug-Principal': 'totally-malformed' },
    });
    expect(res.status).toBe(400);
    const lines = eventsNamed(collector, 'Authn.Failed');
    expect(lines).toHaveLength(1);
    const e = assertDefined(lines[0], 'Authn.Failed log event present after length check');
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
    const e = assertDefined(lines[0], 'Authn.Failed log event present after length check');
    expect(e.properties).toMatchObject({
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
    const resolvedEvent = assertDefined(
      resolved[0],
      'Authn.Resolved log event present after length check',
    );
    const receivedEvent = assertDefined(
      received[0],
      'Request.Received log event present after length check',
    );
    expect(resolvedEvent.correlationId).toBe('corr-principal-test');
    expect(receivedEvent.correlationId).toBe('corr-principal-test');
  });
});
