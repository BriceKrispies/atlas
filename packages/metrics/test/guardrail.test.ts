/**
 * Tests for the guardrail diagnostics helpers — TS port of the Rust
 * `crates/diagnostics` `guardrail!` / `tech_debt!` / `mvp_shortcut!`
 * macros.
 *
 * Verifies:
 *  - `guardrailHitsTotal()` counter has the right name + label set
 *    and increments on each helper call.
 *  - `techDebt()` sets `kind = 'tech_debt'`.
 *  - `mvpShortcut()` sets `kind = 'mvp_shortcut'`.
 *  - Multiple calls with the same `(kind, id, component)` accumulate.
 *  - The structured warn payload matches the Rust event shape and
 *    omits optional fields when not provided.
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  guardrail,
  techDebt,
  mvpShortcut,
  guardrailHitsTotal,
  resetRegistry,
  getRegistry,
} from '@atlas/metrics';

beforeEach(() => {
  resetRegistry();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('guardrailHitsTotal counter', () => {
  test('descriptor matches Rust counterpart (name + labels)', () => {
    const c = guardrailHitsTotal();
    expect(c.descriptor.name).toBe('guardrail_hits_total');
    expect([...c.descriptor.labelNames].sort()).toEqual([
      'component',
      'id',
      'kind',
    ]);
  });

  test('repeat singleton accessor returns same instance', () => {
    expect(guardrailHitsTotal()).toBe(guardrailHitsTotal());
  });
});

describe('guardrail() helper', () => {
  test('increments counter with the supplied labels', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    guardrail({
      kind: 'perf_workaround',
      id: 'cache_invalidation_001',
      component: 'user_service',
      message: 'Using global cache clear instead of selective invalidation',
    });

    const labels = {
      kind: 'perf_workaround',
      id: 'cache_invalidation_001',
      component: 'user_service',
    };
    expect(guardrailHitsTotal().get(labels)).toBe(1);
  });

  test('emits a structured warn payload mirroring the Rust event', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    guardrail({
      kind: 'tech_debt',
      id: 'auth_error_handling_001',
      component: 'auth',
      message: 'sanitize internal error before exposing',
      invariant: 'only on legacy endpoints',
      expires: '2026-06-01',
      ticket: 'JIRA-1234',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith({
      event: 'guardrail',
      kind: 'tech_debt',
      id: 'auth_error_handling_001',
      component: 'auth',
      message: 'sanitize internal error before exposing',
      invariant: 'only on legacy endpoints',
      expires: '2026-06-01',
      ticket: 'JIRA-1234',
    });
  });

  test('omits optional fields from the warn payload when not supplied', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    guardrail({
      kind: 'tech_debt',
      id: 'minimal',
      component: 'core',
      message: 'no optional fields',
    });

    expect(warnSpy).toHaveBeenCalledWith({
      event: 'guardrail',
      kind: 'tech_debt',
      id: 'minimal',
      component: 'core',
      message: 'no optional fields',
    });
    const payload = warnSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect('invariant' in payload).toBe(false);
    expect('expires' in payload).toBe(false);
    expect('ticket' in payload).toBe(false);
  });
});

describe('techDebt() / mvpShortcut() convenience wrappers', () => {
  test('techDebt sets kind = "tech_debt"', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    techDebt({
      id: 'n_plus_one_query_users',
      component: 'user_service',
      message: 'N+1 query when loading users with their permissions',
      expires: 'v2.0.0',
      ticket: 'PERF-456',
    });

    expect(
      guardrailHitsTotal().get({
        kind: 'tech_debt',
        id: 'n_plus_one_query_users',
        component: 'user_service',
      }),
    ).toBe(1);
  });

  test('mvpShortcut sets kind = "mvp_shortcut" (runtime-only, no build break)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mvpShortcut({
      id: 'hardcoded_api_key',
      component: 'external_service',
      message: 'Using hardcoded API key instead of vault',
    });

    expect(
      guardrailHitsTotal().get({
        kind: 'mvp_shortcut',
        id: 'hardcoded_api_key',
        component: 'external_service',
      }),
    ).toBe(1);
  });

  test('techDebt and mvpShortcut keep separate counter series', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    techDebt({ id: 'shared_id', component: 'svc', message: 'a' });
    mvpShortcut({ id: 'shared_id', component: 'svc', message: 'b' });

    expect(
      guardrailHitsTotal().get({
        kind: 'tech_debt',
        id: 'shared_id',
        component: 'svc',
      }),
    ).toBe(1);
    expect(
      guardrailHitsTotal().get({
        kind: 'mvp_shortcut',
        id: 'shared_id',
        component: 'svc',
      }),
    ).toBe(1);
  });
});

describe('counter accumulation per (kind, id, component) tuple', () => {
  test('repeat calls with same labels add up', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 5; i++) {
      techDebt({
        id: 'repeated',
        component: 'core',
        message: 'still here',
      });
    }
    expect(
      guardrailHitsTotal().get({
        kind: 'tech_debt',
        id: 'repeated',
        component: 'core',
      }),
    ).toBe(5);
  });

  test('different ids are tracked as distinct series', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    techDebt({ id: 'a', component: 'svc', message: 'x' });
    techDebt({ id: 'a', component: 'svc', message: 'x' });
    techDebt({ id: 'b', component: 'svc', message: 'y' });

    const c = guardrailHitsTotal();
    expect(c.get({ kind: 'tech_debt', id: 'a', component: 'svc' })).toBe(2);
    expect(c.get({ kind: 'tech_debt', id: 'b', component: 'svc' })).toBe(1);
  });

  test('different components are tracked as distinct series', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    techDebt({ id: 'shared', component: 'svc-a', message: 'x' });
    techDebt({ id: 'shared', component: 'svc-b', message: 'y' });

    const c = guardrailHitsTotal();
    expect(c.get({ kind: 'tech_debt', id: 'shared', component: 'svc-a' })).toBe(1);
    expect(c.get({ kind: 'tech_debt', id: 'shared', component: 'svc-b' })).toBe(1);
  });

  test('counter renders correctly via registry serialize()', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    techDebt({ id: 'render-test', component: 'core', message: 'x' });
    techDebt({ id: 'render-test', component: 'core', message: 'x' });

    const out = getRegistry().serialize();
    expect(out).toContain('# TYPE guardrail_hits_total counter');
    expect(out).toContain(
      'guardrail_hits_total{kind="tech_debt",id="render-test",component="core"} 2',
    );
  });
});
