import { describe, expect, it } from '@atlas/test';
import { openBudget } from '@atlas/dsl-substrate';
import { parse } from './parser.ts';
import { ExpressionEvaluator, makeExpressionEvaluator } from './evaluator.ts';
import { makeDefaultHostContext, makeExpressionRegistry } from './host-ops.ts';
import type { ExprScope } from './ast.ts';

/**
 * Evaluator tests. Each case parses source, evaluates with a scope +
 * the default expression-DSL host-op registry, and asserts the resulting
 * value. Errors are surfaced as `Result.ok === false` — no throws.
 */

async function evalSource(source: string, scope: ExprScope = {}, frozenNow?: string) {
  const parseResult = parse(source);
  if (!parseResult.ok) throw new Error(`parse failed: ${parseResult.error.message}`);
  const evaluator = makeExpressionEvaluator(makeDefaultHostContext(frozenNow));
  const ops = makeExpressionRegistry().ops;
  const budget = openBudget(10_000, 5000);
  return evaluator.evaluate(parseResult.value.ast, scope, ops, budget);
}

describe('evaluator — literals', function () {
  it('evaluates a number literal', async function () {
    const r = await evalSource('42');
    expect(r.ok && r.value).toBe(42);
  });
  it('evaluates a string literal', async function () {
    const r = await evalSource('"hi"');
    expect(r.ok && r.value).toBe('hi');
  });
  it('evaluates booleans', async function () {
    expect((await evalSource('true')).ok && true).toBe(true);
    expect((await evalSource('false')).ok && true).toBe(true);
  });
});

describe('evaluator — identifiers', function () {
  it('resolves shallow identifier', async function () {
    const r = await evalSource('name', { name: 'alice' });
    expect(r.ok && r.value).toBe('alice');
  });
  it('resolves dot-path identifier', async function () {
    const r = await evalSource('user.name', { user: { name: 'bob' } });
    expect(r.ok && r.value).toBe('bob');
  });
  it('returns null for missing identifier', async function () {
    const r = await evalSource('user.missing', { user: { name: 'bob' } });
    expect(r.ok && r.value).toBe(null);
  });
});

describe('evaluator — arithmetic', function () {
  it('adds numbers', async function () {
    const r = await evalSource('2 + 3');
    expect(r.ok && r.value).toBe(5);
  });
  it('respects precedence', async function () {
    const r = await evalSource('2 + 3 * 4');
    expect(r.ok && r.value).toBe(14);
  });
  it('overrides with parens', async function () {
    const r = await evalSource('(2 + 3) * 4');
    expect(r.ok && r.value).toBe(20);
  });
  it('reports division by zero', async function () {
    const r = await evalSource('1 / 0');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DSL_TYPE_ERROR');
  });
});

describe('evaluator — strings', function () {
  it('concatenates string + string via +', async function () {
    const r = await evalSource('"a" + "b"');
    expect(r.ok && r.value).toBe('ab');
  });
  it('coerces number + string to concat', async function () {
    const r = await evalSource('1 + "x"');
    expect(r.ok && r.value).toBe('1x');
  });
});

describe('evaluator — comparisons', function () {
  it('compares numbers', async function () {
    expect((await evalSource('5 < 10')).ok && true).toBe(true);
    expect((await evalSource('5 > 10')).ok && true).toBe(true);
  });
  it('reports type error on mixed-type comparison', async function () {
    const r = await evalSource('"a" < 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DSL_TYPE_ERROR');
  });
});

describe('evaluator — logical', function () {
  it('short-circuits via &&', async function () {
    expect((await evalSource('true && true')).ok && true).toBe(true);
    expect((await evalSource('true && false')).ok && true).toBe(true);
  });
  it('||', async function () {
    expect((await evalSource('false || true')).ok && true).toBe(true);
  });
  it('rejects non-bool operands', async function () {
    const r = await evalSource('1 && 2');
    if (!r.ok) expect(r.error.code).toBe('DSL_TYPE_ERROR');
  });
});

describe('evaluator — host ops', function () {
  it('upper', async function () {
    const r = await evalSource('"abc" | upper');
    expect(r.ok && r.value).toBe('ABC');
  });
  it('lower', async function () {
    const r = await evalSource('"ABC" | lower');
    expect(r.ok && r.value).toBe('abc');
  });
  it('trim', async function () {
    const r = await evalSource('"  abc  " | trim');
    expect(r.ok && r.value).toBe('abc');
  });
  it('len', async function () {
    const r = await evalSource('"hello" | len');
    expect(r.ok && r.value).toBe(5);
  });
  it('escape', async function () {
    const r = await evalSource('"<b>x</b>" | escape');
    expect(r.ok && r.value).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
  it('coalesce', async function () {
    const r = await evalSource('coalesce(missing, "fallback")', { missing: null });
    expect(r.ok && r.value).toBe('fallback');
  });
  it('now reads from frozen host context', async function () {
    const frozen = '2026-05-21T00:00:00.000Z';
    const r = await evalSource('now()', {}, frozen);
    expect(r.ok && r.value).toBe(frozen);
  });
  it('format substitutes %s and %d', async function () {
    const r = await evalSource('format("hello %s, you are %d", "alice", 30)');
    expect(r.ok && r.value).toBe('hello alice, you are 30');
  });
});

describe('evaluator — pipe chain', function () {
  it('chains pipes left-associatively', async function () {
    const r = await evalSource('"  abc  " | trim | upper');
    expect(r.ok && r.value).toBe('ABC');
  });
});

describe('evaluator — determinism', function () {
  it('returns the same value across repeated evaluations with same inputs', async function () {
    const scope = { user: { name: 'eve' } };
    const a = await evalSource('user.name | upper', scope, '2026-05-21T00:00:00.000Z');
    const b = await evalSource('user.name | upper', scope, '2026-05-21T00:00:00.000Z');
    expect(a.ok && a.value).toBe('EVE');
    expect(b.ok && b.value).toBe('EVE');
  });
});

describe('evaluator — budget enforcement', function () {
  it('returns DSL_BUDGET_EXCEEDED when step budget is too small', async function () {
    const evaluator = new ExpressionEvaluator();
    const parseResult = parse('1 + 2 + 3 + 4 + 5');
    if (!parseResult.ok) throw new Error('parse failed');
    const ops = makeExpressionRegistry().ops;
    const tinyBudget = openBudget(1, 5000);
    const r = await evaluator.evaluate(parseResult.value.ast, {}, ops, tinyBudget);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DSL_BUDGET_EXCEEDED');
  });
  it('completes within a generous budget', async function () {
    const r = await evalSource('1 + 2 + 3 + 4 + 5');
    expect(r.ok && r.value).toBe(15);
  });
});
