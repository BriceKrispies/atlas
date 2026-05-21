import { describe, expect, it } from '@atlas/test';
import { makeConformanceChecker } from '@atlas/dsl-substrate';
import type { DslConformanceArgs, DslConformanceSample } from '@atlas/dsl-substrate';
import { parse } from './parser.ts';
import { makeExpressionEvaluator } from './evaluator.ts';
import { makeDefaultHostContext, makeExpressionRegistry } from './host-ops.ts';
import { KNOWN_OP_NAMES } from './known-ops.ts';
import type { ExprAst, ExprScope, ExprValue } from './ast.ts';
import type { ExprOps } from './host-ops.ts';

/**
 * Mechanical proof that the expression DSL satisfies ADR 0007 §2's six
 * properties via the substrate's `makeConformanceChecker`.
 *
 * This file is the deliverable promised by ADR 0007 §"Constraints" item 1:
 * "Each DSL capability spec MUST include a 'DSL contract conformance'
 * section demonstrating §2 properties 1–6. Specs that don't are rejected."
 * The conformance demonstration is now executable.
 */

function p(source: string): ExprAst {
  const r = parse(source);
  if (!r.ok) throw new Error(`parse failed for '${source}': ${r.error.message}`);
  return r.value.ast;
}

function buildSamples(): ReadonlyArray<DslConformanceSample<ExprAst, ExprScope, ExprOps>> {
  const ops = makeExpressionRegistry().ops;
  return [
    {
      name: 'literal-number',
      ast: p('42'),
      scope: {},
      ops,
      expect: { outcome: 'ok' },
    },
    {
      name: 'arithmetic',
      ast: p('2 + 3 * 4'),
      scope: {},
      ops,
      expect: { outcome: 'ok' },
    },
    {
      name: 'pipe-chain',
      ast: p('"  hi  " | trim | upper'),
      scope: {},
      ops,
      expect: { outcome: 'ok' },
    },
    {
      name: 'host-now',
      ast: p('now()'),
      scope: {},
      ops,
      expect: { outcome: 'ok' },
    },
    {
      name: 'identifier-resolution',
      ast: p('user.name | upper'),
      scope: { user: { name: 'alice' } },
      ops,
      expect: { outcome: 'ok' },
    },
    {
      name: 'unknown-identifier',
      ast: p('mystery.thing'),
      scope: {},
      ops,
      hints: { expectedScopeShape: { user: { name: 'alice' } } },
      expect: { outcome: 'error', code: 'DSL_UNKNOWN_IDENTIFIER' },
    },
    {
      name: 'unknown-filter',
      ast: p('"x" | nonexistent_filter'),
      scope: {},
      ops,
      hints: { expectedScopeShape: {} },
      expect: { outcome: 'error', code: 'DSL_UNKNOWN_IDENTIFIER' },
    },
  ];
}

function args(): DslConformanceArgs<'expression', ExprAst, ExprScope, ExprValue, ExprOps> {
  return {
    kind: 'expression',
    makeEvaluator: () =>
      makeExpressionEvaluator(makeDefaultHostContext('2026-05-21T00:00:00.000Z')),
    registry: makeExpressionRegistry(),
    samples: buildSamples(),
  };
}

describe('expression DSL — ADR 0007 §2 conformance', function () {
  const checker = makeConformanceChecker();

  it('property 1 — bounded (stepCost >= 1 for every sample)', function () {
    const violations = checker.checkBounded(args());
    expect(violations).toEqual([]);
  });

  it('property 2 — pure (repeated evaluation yields same value)', async function () {
    const violations = await checker.checkPure(args());
    expect(violations).toEqual([]);
  });

  it('property 3 — no ambient I/O (effectful ops declare a port)', function () {
    const violations = checker.checkNoAmbientIo(args());
    expect(violations).toEqual([]);
  });

  it('property 4 — deterministic (same as pure for this DSL)', async function () {
    const violations = await checker.checkDeterministic(args());
    expect(violations).toEqual([]);
  });

  it('property 5 — budget-enforced (tiny budget aborts with DSL_BUDGET_EXCEEDED)', async function () {
    const violations = await checker.checkBudgetEnforced(args());
    expect(violations).toEqual([]);
  });

  it('property 6 — statically typeable (unknown identifiers caught by staticCheck)', function () {
    const violations = checker.checkStaticallyTypeable(args());
    expect(violations).toEqual([]);
  });
});

describe('expression DSL — registry / known-ops parity', function () {
  it('KNOWN_OP_NAMES matches the registry keys', function () {
    const registryNames = new Set(
      makeExpressionRegistry()
        .list()
        .map((o) => o.name),
    );
    expect(registryNames).toEqual(KNOWN_OP_NAMES);
  });

  it('all ops in the registry are pure with port: null', function () {
    for (const op of makeExpressionRegistry().list()) {
      expect(op.category).toBe('pure');
      expect(op.port).toBe(null);
    }
  });
});
