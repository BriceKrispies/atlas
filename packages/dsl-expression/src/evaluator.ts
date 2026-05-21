/**
 * Evaluator for the expression DSL.
 *
 * Walks the AST recursively. Charges 1 step per node visit via the
 * substrate's `BudgetTicket`. Effects route exclusively through `hostOps`.
 * Returns `Result<ExprValue, DslError>` — no throws.
 *
 * Type coercion is permissive at runtime. Identifiers walk the scope
 * with optional-chain semantics: a missing dot-path step yields
 * `undefined`, which propagates through. Numeric + string operands of
 * `+` produce string concatenation; numeric + numeric produces a
 * number. Comparison ops require both operands to be numbers or both
 * strings; mismatched shapes surface as `DSL_TYPE_ERROR`.
 *
 * Determinism: all host ops are pure, AND `now()` reads from the
 * host-supplied `ctx.frozenNow`. Two evaluations of the same
 * `(ast, scope, hostOps, ctx)` yield the same `Result.value`.
 */

import type {
  BudgetTicket,
  DslError,
  DslEvaluator,
  HostOpContext,
  Result,
  StaticCheckHints,
} from '@atlas/dsl-substrate';
import type { ExprAst, ExprScope, ExprValue, BinOp } from './ast.ts';
import { staticCheck as staticCheckImpl } from './static-check.ts';
import { makeDefaultHostContext } from './host-ops.ts';
import type { ExprOps } from './host-ops.ts';

function errOk<T>(value: T): Result<T, DslError> {
  return { ok: true, value };
}
function errBad(error: DslError): Result<ExprValue, DslError> {
  return { ok: false, error };
}

function lookupPath(scope: ExprScope, path: ReadonlyArray<string>): unknown {
  let current: unknown = scope;
  for (const seg of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function coerceToExprValue(v: unknown): ExprValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  // Defensive — host scope may carry objects, but the expression DSL
  // value space is scalar. Surface as their stringified form.
  return JSON.stringify(v);
}

function applyBinop(op: BinOp, left: ExprValue, right: ExprValue): Result<ExprValue, DslError> {
  switch (op) {
    case '+':
      if (typeof left === 'number' && typeof right === 'number') return errOk(left + right);
      if (typeof left === 'string' || typeof right === 'string') {
        return errOk(`${left ?? ''}${right ?? ''}`);
      }
      return {
        ok: false,
        error: { code: 'DSL_TYPE_ERROR', message: "operator '+' requires numbers or strings" },
      };
    case '-':
    case '*':
    case '/':
    case '%':
      if (typeof left !== 'number' || typeof right !== 'number') {
        return {
          ok: false,
          error: { code: 'DSL_TYPE_ERROR', message: `operator '${op}' requires numeric operands` },
        };
      }
      if (op === '-') return errOk(left - right);
      if (op === '*') return errOk(left * right);
      if (op === '/') {
        if (right === 0) {
          return { ok: false, error: { code: 'DSL_TYPE_ERROR', message: 'division by zero' } };
        }
        return errOk(left / right);
      }
      if (op === '%') {
        if (right === 0) {
          return { ok: false, error: { code: 'DSL_TYPE_ERROR', message: 'modulo by zero' } };
        }
        return errOk(left % right);
      }
      // unreachable
      return errOk(null);
    case '==':
      return errOk(left === right);
    case '!=':
      return errOk(left !== right);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const numCmp = typeof left === 'number' && typeof right === 'number';
      const strCmp = typeof left === 'string' && typeof right === 'string';
      if (!numCmp && !strCmp) {
        return {
          ok: false,
          error: {
            code: 'DSL_TYPE_ERROR',
            message: `operator '${op}' requires both numbers or both strings`,
          },
        };
      }
      if (op === '<') return errOk(left < right);
      if (op === '<=') return errOk(left <= right);
      if (op === '>') return errOk(left > right);
      return errOk(left >= right);
    }
    case '&&':
      if (typeof left !== 'boolean' || typeof right !== 'boolean') {
        return {
          ok: false,
          error: { code: 'DSL_TYPE_ERROR', message: "operator '&&' requires boolean operands" },
        };
      }
      return errOk(left && right);
    case '||':
      if (typeof left !== 'boolean' || typeof right !== 'boolean') {
        return {
          ok: false,
          error: { code: 'DSL_TYPE_ERROR', message: "operator '||' requires boolean operands" },
        };
      }
      return errOk(left || right);
  }
}

interface EvalCtx {
  scope: ExprScope;
  ops: ExprOps;
  budget: BudgetTicket;
  host: HostOpContext;
}

async function evalNode(node: ExprAst, c: EvalCtx): Promise<Result<ExprValue, DslError>> {
  const charge = c.budget.consumeSteps(1);
  if (!charge.ok) return charge;

  switch (node.kind) {
    case 'lit':
      return errOk(node.value);
    case 'ident':
      return errOk(coerceToExprValue(lookupPath(c.scope, node.path)));
    case 'binop': {
      const l = await evalNode(node.left, c);
      if (!l.ok) return l;
      const r = await evalNode(node.right, c);
      if (!r.ok) return r;
      return applyBinop(node.op, l.value, r.value);
    }
    case 'unop': {
      const v = await evalNode(node.operand, c);
      if (!v.ok) return v;
      if (node.op === '-') {
        if (typeof v.value !== 'number') {
          return errBad({ code: 'DSL_TYPE_ERROR', message: "unary '-' requires numeric operand" });
        }
        return errOk(-v.value);
      }
      // '!'
      if (typeof v.value !== 'boolean') {
        return errBad({ code: 'DSL_TYPE_ERROR', message: "unary '!' requires boolean operand" });
      }
      return errOk(!v.value);
    }
    case 'call': {
      const op = c.ops[node.name];
      if (!op) {
        return errBad({
          code: 'DSL_UNKNOWN_IDENTIFIER',
          message: `unknown host op '${node.name}'`,
        });
      }
      const argVals: unknown[] = [];
      for (const a of node.args) {
        const v = await evalNode(a, c);
        if (!v.ok) return v;
        argVals.push(v.value);
      }
      const out = await op.invoke(argVals as readonly unknown[], c.host);
      if (!out.ok) {
        return errBad({
          code: 'DSL_HOST_OP_FAILED',
          message: `host op '${node.name}' failed: ${out.error.reason}`,
          cause: out.error,
        });
      }
      return errOk(coerceToExprValue(out.value));
    }
    case 'pipe': {
      const v = await evalNode(node.expr, c);
      if (!v.ok) return v;
      const op = c.ops[node.filter];
      if (!op) {
        return errBad({
          code: 'DSL_UNKNOWN_IDENTIFIER',
          message: `unknown filter '${node.filter}'`,
        });
      }
      const argVals: unknown[] = [v.value];
      for (const a of node.args) {
        const av = await evalNode(a, c);
        if (!av.ok) return av;
        argVals.push(av.value);
      }
      const out = await op.invoke(argVals as readonly unknown[], c.host);
      if (!out.ok) {
        return errBad({
          code: 'DSL_HOST_OP_FAILED',
          message: `filter '${node.filter}' failed: ${out.error.reason}`,
          cause: out.error,
        });
      }
      return errOk(coerceToExprValue(out.value));
    }
  }
}

/**
 * Concrete `DslEvaluator` implementation for the expression DSL.
 *
 * Stateless — multiple evaluations share the same instance safely. The
 * per-evaluation `HostOpContext` is captured at the top-level `evaluate`
 * call (via `_hostCtx` private field) so nested node evaluations see the
 * same frozen `now`.
 */
export class ExpressionEvaluator implements DslEvaluator<ExprAst, ExprScope, ExprValue, ExprOps> {
  constructor(private readonly hostCtx: HostOpContext = makeDefaultHostContext()) {}

  async evaluate(
    ast: ExprAst,
    scope: ExprScope,
    hostOps: ExprOps,
    budget: BudgetTicket,
  ): Promise<Result<ExprValue, DslError>> {
    return evalNode(ast, { scope, ops: hostOps, budget, host: this.hostCtx });
  }

  staticCheck(ast: ExprAst, hints: StaticCheckHints): ReadonlyArray<DslError> {
    return staticCheckImpl(ast, hints);
  }

  stepCost(_node: unknown): number {
    // Uniform cost — 1 per node visit. A future refinement could weight
    // certain nodes (e.g. host-op calls) higher to make budget tuning
    // more meaningful, but uniform is the right default per ADR 0007 §2
    // property 1 (bounded by node count).
    return 1;
  }
}

/**
 * Convenience factory. Equivalent to `new ExpressionEvaluator()` but with
 * an optional host context for tests / conformance.
 */
export function makeExpressionEvaluator(host?: HostOpContext): ExpressionEvaluator {
  return host ? new ExpressionEvaluator(host) : new ExpressionEvaluator();
}
