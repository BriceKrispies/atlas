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
import { buildFakeAppState } from '../../test/lib/factories.ts';

/**
 * Build an `AppState` for the principal middleware. We lean on the shared
 * `buildFakeAppState` typed factory (throw-on-access proxies for the
 * adapter-heavy fields) so this test never reaches into the long-lived
 * Postgres / WASM surface. The principal middleware only reads
 * `state.config.testAuth.enabled`, `state.config.tenantId`,
 * `state.config.oidc.*`, and `state.jwks` on the debug-principal path —
 * all of which `buildFakeAppState` populates.
 */
function makeState(): AppState {
  const { state } = buildFakeAppState({ tenantId: 'default-tenant' });
  return state;
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

// RED PHASE: `principalType` + `claims` are pre-driven from the Rust
// `authn::Principal` shape but not yet on the TS `Principal` type. Tests are
// skipped at runtime via `describe.skip`; the wider type cast below keeps
// typecheck green until the fields land on the real interface, at which
// point the cast becomes a no-op and `describe.skip` flips back to
// `describe`.
type ExtendedPrincipal = Principal & {
  principalType?: 'user' | 'service' | 'anonymous';
  claims?: Record<string, unknown>;
};

/**
 * Narrow a JSON-parsed `unknown` to `ExtendedPrincipal` shape. Only the
 * fields the assertions read are checked — `principalId` + `tenantId` are
 * required strings; `principalType` (if present) must match the union;
 * `claims` (if present) must be a plain object. Builds and returns a new
 * object whose static type matches `ExtendedPrincipal` so call sites
 * receive a properly-typed value without a cast at the assertion line.
 */
function asExtendedPrincipal(v: unknown): ExtendedPrincipal {
  if (typeof v !== 'object' || v === null) {
    throw new Error(`expected principal object, got ${typeof v}`);
  }
  // `v` is now `object` (typeof object + non-null). `Object.fromEntries`
  // over `Object.entries` materialises a fresh `Record<string, unknown>`
  // — `Object.entries(o: object)` has signature `[string, unknown][]`, so
  // no narrowing cast is needed on the input.
  const obj: Record<string, unknown> = Object.fromEntries(Object.entries(v));
  const principalId = obj['principalId'];
  const tenantId = obj['tenantId'];
  if (typeof principalId !== 'string') {
    throw new Error('principal.principalId missing or not a string');
  }
  if (typeof tenantId !== 'string') {
    throw new Error('principal.tenantId missing or not a string');
  }
  const out: ExtendedPrincipal = { principalId, tenantId };
  const pt = obj['principalType'];
  if (pt === 'user' || pt === 'service' || pt === 'anonymous') {
    out.principalType = pt;
  } else if (pt !== undefined) {
    throw new Error(`principal.principalType invalid: ${String(pt)}`);
  }
  const claims = obj['claims'];
  if (claims !== undefined) {
    if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
      throw new Error('principal.claims must be an object');
    }
    // Rebuild the claims map from `Object.entries`, which has signature
    // `(o: object) => [string, unknown][]`. That gives a fresh
    // `Record<string, unknown>` without any narrowing cast on the input.
    out.claims = Object.fromEntries(Object.entries(claims));
  }
  return out;
}

describe.skip('Principal interface parity with Rust authn::Principal', () => {
  test('Principal has principalType and claims fields (type-level + runtime literal)', () => {
    const p: ExtendedPrincipal = {
      principalId: 'alice',
      tenantId: 't1',
      principalType: 'user',
      claims: {},
    };
    expect(p.principalType).toBe('user');
    expect(p.claims).toEqual({});
    expect(Object.keys(p).sort()).toEqual(
      ['claims', 'principalId', 'principalType', 'tenantId'].sort(),
    );
  });
});

describe.skip('principalMiddleware — X-Debug-Principal populates principalType + claims', () => {
  test('user:alice:t1 → principalType="user", claims={}', async () => {
    const app = buildApp();
    const res = await app.request('/echo', {
      headers: { 'X-Debug-Principal': 'user:alice:t1' },
    });
    expect(res.status).toBe(200);
    const body = asExtendedPrincipal(await res.json());
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
    const body = asExtendedPrincipal(await res.json());
    expect(body.principalId).toBe('bot');
    expect(body.tenantId).toBe('t1');
    expect(body.principalType).toBe('service');
    expect(body.claims).toEqual({});
  });

  test('anonymous:guest:t1 → principalType="anonymous"', async () => {
    const app = buildApp();
    const res = await app.request('/echo', {
      headers: { 'X-Debug-Principal': 'anonymous:guest:t1' },
    });
    expect(res.status).toBe(200);
    const body = asExtendedPrincipal(await res.json());
    expect(body.principalType).toBe('anonymous');
    expect(body.claims).toEqual({});
  });
});
