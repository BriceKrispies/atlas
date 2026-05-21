import { describe, expect, it } from '@atlas/test';
import { stubConformanceChecker } from './contract-tests.ts';
import type { DslConformanceArgs } from './contract-tests.ts';
import type { DslEvaluator } from './evaluator.ts';
import type { HostOpRegistry, HostOpSet } from './host-ops.ts';

/**
 * Meta-test: the contract checker SHAPE is sound before any concrete DSL
 * relies on it.
 *
 * Slice #1 ships the stub `stubConformanceChecker` whose six methods
 * uniformly emit a placeholder violation. That's enough to prove:
 *   1. The factory is callable and returns the expected method set.
 *   2. Each of the six methods returns the right return type (sync
 *      `ReadonlyArray<string>` or async `Promise<ReadonlyArray<string>>`).
 *   3. Synthetic args composed from the substrate's generic types compile
 *      against the checker's signature.
 *
 * The real assertion bodies land with the first concrete DSL (slice #3),
 * which replaces `stubConformanceChecker` with a runner that drives
 * `describe` / `test` blocks via `@atlas/test`. Until then this meta-test
 * is the structural proof.
 */

interface FakeAst {
  readonly kind: 'lit';
  readonly value: number;
  readonly id: string;
}
interface FakeScope {
  readonly user: { readonly name: string };
}
type FakeOutput = string;

interface FakeOps extends HostOpSet {
  readonly upper: {
    readonly name: 'upper';
    readonly category: 'pure';
    readonly port: null;
    invoke(args: readonly [string]): Promise<{ ok: true; value: string }>;
  };
}

function fakeEvaluator(): DslEvaluator<FakeAst, FakeScope, FakeOutput, FakeOps> {
  return {
    async evaluate() {
      return { ok: true, value: 'placeholder' };
    },
    staticCheck() {
      return [];
    },
    stepCost() {
      return 1;
    },
  };
}

function fakeRegistry(): HostOpRegistry<FakeOps> {
  const ops: FakeOps = {
    upper: {
      name: 'upper',
      category: 'pure',
      port: null,
      async invoke(args: readonly [string]) {
        return { ok: true, value: args[0].toUpperCase() };
      },
    },
  };
  return {
    kind: 'fake',
    ops,
    list() {
      return [{ name: 'upper', category: 'pure', port: null }];
    },
  };
}

function fakeArgs(): DslConformanceArgs<'fake', FakeAst, FakeScope, FakeOutput, FakeOps> {
  return {
    kind: 'fake',
    makeEvaluator: fakeEvaluator,
    registry: fakeRegistry(),
    samples: [
      {
        name: 'sample-1',
        ast: { kind: 'lit', value: 1, id: 'n1' },
        scope: { user: { name: 'test' } },
        ops: fakeRegistry().ops,
        expect: { outcome: 'ok' },
      },
    ],
  };
}

describe('stubConformanceChecker', function () {
  it('returns a checker with the six §2-property methods', function () {
    const checker = stubConformanceChecker();
    expect(typeof checker.checkBounded).toBe('function');
    expect(typeof checker.checkPure).toBe('function');
    expect(typeof checker.checkNoAmbientIo).toBe('function');
    expect(typeof checker.checkDeterministic).toBe('function');
    expect(typeof checker.checkBudgetEnforced).toBe('function');
    expect(typeof checker.checkStaticallyTypeable).toBe('function');
  });

  it('the synchronous checks emit a stub violation', function () {
    const checker = stubConformanceChecker();
    const args = fakeArgs();
    expect(checker.checkBounded(args).length).toBeGreaterThan(0);
    expect(checker.checkNoAmbientIo(args).length).toBeGreaterThan(0);
    expect(checker.checkStaticallyTypeable(args).length).toBeGreaterThan(0);
  });

  it('the async checks resolve to a stub violation', async function () {
    const checker = stubConformanceChecker();
    const args = fakeArgs();
    const pure = await checker.checkPure(args);
    const determ = await checker.checkDeterministic(args);
    const budget = await checker.checkBudgetEnforced(args);
    expect(pure.length).toBeGreaterThan(0);
    expect(determ.length).toBeGreaterThan(0);
    expect(budget.length).toBeGreaterThan(0);
  });

  it('checker accepts a synthetic DslConformanceArgs without `any` casts', function () {
    // The point of this case is that `fakeArgs()` compiles: the substrate's
    // generic constraints on `DslConformanceArgs` admit a sane fake at the
    // call site. If a future refactor breaks that compilation, this test
    // fails to typecheck — which is the meta-property we want.
    const args = fakeArgs();
    expect(args.kind).toBe('fake');
    expect(args.samples.length).toBe(1);
  });
});
