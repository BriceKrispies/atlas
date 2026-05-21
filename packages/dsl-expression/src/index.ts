/**
 * @atlas/dsl-expression — first concrete DSL kind built on
 * `@atlas/dsl-substrate`.
 *
 * Grammar: `${user.name | upper}` style. Pure host ops only — no port
 * hops, no I/O. Conforms to ADR 0007 §2's six properties; this is
 * verified mechanically via the substrate's `makeConformanceChecker`
 * against a corpus of samples (see `conformance.test.ts`).
 *
 * Public surface:
 *   - Types: `ExprAst`, `BinOp`, `UnOp`, `ExprValue`, `ExprScope`, `ExprOps`
 *   - Parser: `parse(source) -> Result<{ast, sourceMap}, DslError>`
 *   - Static check: `staticCheck(ast, hints) -> ReadonlyArray<DslError>`
 *   - Evaluator: `ExpressionEvaluator` class + `makeExpressionEvaluator()`
 *     factory
 *   - Host ops: `makeExpressionRegistry()` returns the closed `ExprOps`
 *     set; `makeDefaultHostContext()` builds a stand-alone `HostOpContext`
 *     for tests
 *   - `KNOWN_OP_NAMES` for the static checker
 */

export type { ExprAst, BinOp, UnOp, ExprValue, ExprScope } from './ast.ts';
export type { StaticCheckHints } from './static-check.ts';
export type { ExprOps } from './host-ops.ts';
export type { ParseResult } from './parser.ts';

export { parse } from './parser.ts';
export { staticCheck } from './static-check.ts';
export { ExpressionEvaluator, makeExpressionEvaluator } from './evaluator.ts';
export { makeExpressionRegistry, makeDefaultHostContext } from './host-ops.ts';
export { KNOWN_OP_NAMES } from './known-ops.ts';
