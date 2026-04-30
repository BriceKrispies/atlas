/**
 * Failing tests for the TS `Principal` parity-with-Rust extension.
 *
 * Rust counterpart: `crates/ingress/src/authn.rs`
 *   pub enum PrincipalType { User, Service, Anonymous }   // serde rename_all="lowercase"
 *   pub struct Principal {
 *     pub id: String,
 *     pub principal_type: PrincipalType,
 *     pub tenant_id: String,
 *     pub claims: HashMap<String, serde_json::Value>,
 *   }
 *
 * The TS `Principal` in `packages/platform-core/src/types.ts` currently only
 * carries `principalId` and `tenantId`. These tests pin the desired shape:
 *
 *   1. The interface gains `principalType: 'user' | 'service' | 'anonymous'`
 *      and `claims: Record<string, unknown>`.
 *   2. The X-Debug-Principal pathway populates `principalType` from the
 *      header prefix and leaves `claims` as `{}` — matching the Rust
 *      `parse_debug_principal` behaviour (`Principal::new` constructs
 *      `claims: HashMap::new()`).
 *   3. The `service:` prefix yields `principalType: 'service'`, again
 *      matching Rust's `parse_principal_type`.
 *
 * Test #4 (JWT path → `claims` populated from verified payload) is omitted:
 * mocking `jose.jwtVerify` for a module imported via a TS-only ESM path
 * inside a workspace package would entail more wiring than this red-phase
 * commit warrants. The JWT-side claim population is exercised separately
 * once the source change lands.
 *
 * Red phase: every test below MUST fail today because:
 *   - `Principal` lacks `principalType` and `claims` (TS type error / runtime undefined)
 *   - `parseDebugPrincipal` (in `principal.ts`) does not set those fields
 */

import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import type { Principal } from '@atlas/platform-core';
import { principalMiddleware, type ServerVariables } from './principal.ts';
import type { AppState } from '../bootstrap.ts';

/**
 * Minimal AppState shim. Only the fields the principal middleware reads
 * are populated; everything else is a typed `null`/cast to keep the test
 * focused. Mirrors the boot fields used in `principal.ts`:
 * `state.config.testAuth.enabled`, `state.config.tenantId`,
 * `state.config.oidc.*`, `state.jwks`.
 */
function makeState(): AppState {
  const config = {
    port: 3000,
    controlPlaneDbUrl: 'postgres://unused',
    oidc: { issuerUrl: '', jwksUrl: '', audience: '' },
    testAuth: { enabled: true, debugEndpoints: false },
    tenantId: 'default-tenant',
    rustLog: '',
    policyEngine: 'stub' as const,
  };
  return {
    config,
    controlPlaneSql: null as never,
    tenantDb: null as never,
    controlPlaneRegistry: null as never,
    jwks: null,
    migratedTenants: new Set<string>(),
    policyEngine: null as never,
    wasmHost: null as never,
  } as unknown as AppState;
}

/**
 * Build a Hono app with the middleware mounted and a sink route that echoes
 * back the principal stored on the context. This is how we observe
 * `parseDebugPrincipal` indirectly without exporting it from the source.
 */
function buildApp() {
  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('*', principalMiddleware(makeState()));
  app.get('/echo', (c) => {
    const p = c.get('principal');
    return c.json(p);
  });
  return app;
}

describe('Principal interface parity with Rust authn::Principal', () => {
  test('Principal has principalType and claims fields (type-level + runtime literal)', () => {
    // Construct a literal that is only assignable to `Principal` if the new
    // fields exist on the interface. `as Principal` would silently widen so
    // we deliberately use a fresh-object check + typeof assertion.
    const p: Principal = {
      principalId: 'alice',
      tenantId: 't1',
      // The next two fields MUST be part of the interface for this to typecheck.
      principalType: 'user',
      claims: {},
    };
    expect(p.principalType).toBe('user');
    expect(p.claims).toEqual({});
    // Runtime cross-check: the keys exist on the value.
    expect(Object.keys(p).sort()).toEqual(
      ['claims', 'principalId', 'principalType', 'tenantId'].sort(),
    );
  });
});

describe('principalMiddleware — X-Debug-Principal populates principalType + claims', () => {
  test('user:alice:t1 → principalType="user", claims={}', async () => {
    const app = buildApp();
    const res = await app.request('/echo', {
      headers: { 'X-Debug-Principal': 'user:alice:t1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Principal;
    expect(body.principalId).toBe('alice');
    expect(body.tenantId).toBe('t1');
    expect(body.principalType).toBe('user');
    expect(body.claims).toEqual({});
  });

  test('service:bot:t1 → principalType="service"', async () => {
    const app = buildApp();
    const res = await app.request('/echo', {
      headers: { 'X-Debug-Principal': 'service:bot:t1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Principal;
    expect(body.principalId).toBe('bot');
    expect(body.tenantId).toBe('t1');
    expect(body.principalType).toBe('service');
    expect(body.claims).toEqual({});
  });

  test('anonymous:guest:t1 → principalType="anonymous"', async () => {
    // Sanity case to lock in the third Rust enum variant. Same source file,
    // same `parse_principal_type` lowercase match, same expected result.
    const app = buildApp();
    const res = await app.request('/echo', {
      headers: { 'X-Debug-Principal': 'anonymous:guest:t1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Principal;
    expect(body.principalType).toBe('anonymous');
    expect(body.claims).toEqual({});
  });
});
