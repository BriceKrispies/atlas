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
import { assertDefined } from '@atlas/test-fixtures/assert';
import {
  guardrail,
  techDebt,
  mvpShortcut,
  guardrailHitsTotal,
  resetRegistry,
  getRegistry,
  setGuardrailLogger,
} from '@atlas/metrics';

interface LoggerCall {
  msg: string;
  fields: Record<string, unknown>;
}

interface SpyLogger {
  warn(msg: string, fields?: Record<string, unknown>): void;
  calls: LoggerCall[];
}

function makeLogger(): SpyLogger {
  const calls: LoggerCall[] = [];
  return {
    warn(msg: string, fields?: Record<string, unknown>): void {
      calls.push({ msg, fields: fields ?? {} });
    },
    calls,
  };
}

beforeEach(() => {
  resetRegistry();
  setGuardrailLogger(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  setGuardrailLogger(null);
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

  test('writes a structured warn record via the supplied logger', () => {
    const logger = makeLogger();
    guardrail(
      {
        kind: 'tech_debt',
        id: 'auth_error_handling_001',
        component: 'auth',
        message: 'sanitize internal error before exposing',
        invariant: 'only on legacy endpoints',
        expires: '2026-06-01',
        ticket: 'JIRA-1234',
      },
      logger,
    );

    expect(logger.calls).toHaveLength(1);
    const call = assertDefined(logger.calls[0], 'expected one logger call after guardrail()');
    expect(call.msg).toBe('guardrail');
    expect(call.fields).toEqual({
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

  test('omits optional fields when not supplied', () => {
    const logger = makeLogger();
    guardrail(
      {
        kind: 'tech_debt',
        id: 'minimal',
        component: 'core',
        message: 'no optional fields',
      },
      logger,
    );

    expect(logger.calls).toHaveLength(1);
    const fields = assertDefined(logger.calls[0], 'expected one logger call').fields;
    expect(fields).toEqual({
      event: 'guardrail',
      kind: 'tech_debt',
      id: 'minimal',
      component: 'core',
      message: 'no optional fields',
    });
    expect('invariant' in fields).toBe(false);
    expect('expires' in fields).toBe(false);
    expect('ticket' in fields).toBe(false);
  });

  test('falls back to the registered process logger when no arg is passed', () => {
    const logger = makeLogger();
    setGuardrailLogger(logger);
    guardrail({
      kind: 'tech_debt',
      id: 'registered',
      component: 'core',
      message: 'via registry',
    });
    expect(logger.calls).toHaveLength(1);
    expect(assertDefined(logger.calls[0], 'expected one logger call').msg).toBe('guardrail');
  });

  test('does not throw when no logger is available — counter still ticks', () => {
    expect(() =>
      guardrail({
        kind: 'tech_debt',
        id: 'no-logger',
        component: 'core',
        message: 'silent',
      }),
    ).not.toThrow();
    expect(
      guardrailHitsTotal().get({
        kind: 'tech_debt',
        id: 'no-logger',
        component: 'core',
      }),
    ).toBe(1);
  });
});

describe('techDebt() / mvpShortcut() convenience wrappers', () => {
  test('techDebt sets kind = "tech_debt"', () => {
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

  test('wrappers forward the explicit logger argument', () => {
    const logger = makeLogger();
    techDebt({ id: 'fwd', component: 'svc', message: 'x' }, logger);
    mvpShortcut({ id: 'fwd', component: 'svc', message: 'x' }, logger);
    expect(logger.calls).toHaveLength(2);
    expect(assertDefined(logger.calls[0], 'expected techDebt logger call').fields['kind']).toBe(
      'tech_debt',
    );
    expect(assertDefined(logger.calls[1], 'expected mvpShortcut logger call').fields['kind']).toBe(
      'mvp_shortcut',
    );
  });
});

describe('counter accumulation per (kind, id, component) tuple', () => {
  test('repeat calls with same labels add up', () => {
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
    techDebt({ id: 'a', component: 'svc', message: 'x' });
    techDebt({ id: 'a', component: 'svc', message: 'x' });
    techDebt({ id: 'b', component: 'svc', message: 'y' });

    const c = guardrailHitsTotal();
    expect(c.get({ kind: 'tech_debt', id: 'a', component: 'svc' })).toBe(2);
    expect(c.get({ kind: 'tech_debt', id: 'b', component: 'svc' })).toBe(1);
  });

  test('different components are tracked as distinct series', () => {
    techDebt({ id: 'shared', component: 'svc-a', message: 'x' });
    techDebt({ id: 'shared', component: 'svc-b', message: 'y' });

    const c = guardrailHitsTotal();
    expect(c.get({ kind: 'tech_debt', id: 'shared', component: 'svc-a' })).toBe(1);
    expect(c.get({ kind: 'tech_debt', id: 'shared', component: 'svc-b' })).toBe(1);
  });

  test('counter renders correctly via registry serialize()', () => {
    techDebt({ id: 'render-test', component: 'core', message: 'x' });
    techDebt({ id: 'render-test', component: 'core', message: 'x' });

    const out = getRegistry().serialize();
    expect(out).toContain('# TYPE guardrail_hits_total counter');
    expect(out).toContain(
      'guardrail_hits_total{kind="tech_debt",id="render-test",component="core"} 2',
    );
  });
});
