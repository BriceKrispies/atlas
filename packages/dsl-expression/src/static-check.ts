/**
 * Static checker for the expression DSL.
 *
 * Walks an `ExprAst` once without evaluating anything. Catches:
 *   - `DSL_UNKNOWN_IDENTIFIER` — identifier path not present in
 *     `hints.expectedScopeShape` (when provided).
 *   - `DSL_TYPE_ERROR` — binary / unary op applied to a literal of the
 *     wrong shape (e.g. `"a" - 1`). Best-effort: only flags errors
 *     visible from literals; identifier-shaped operands are accepted.
 *
 * Returns the list of errors found. Empty list = the artifact passes
 * static analysis. No throws — the substrate's no-throws property holds
 * here too.
 */

import type { DslError } from '@atlas/dsl-substrate';
import type { ExprAst } from './ast.ts';
import { KNOWN_OP_NAMES } from './known-ops.ts';

export interface StaticCheckHints {
  /**
   * Optional shape of the expected scope. When supplied, identifier paths
   * are checked against it; unknown paths surface as
   * `DSL_UNKNOWN_IDENTIFIER`. Without hints, identifier checks are skipped
   * (runtime evaluation will surface missing scope entries).
   */
  readonly expectedScopeShape?: Readonly<Record<string, unknown>>;
  readonly authoredSubstrateVersion?: string;
}

function pathExistsInShape(
  path: ReadonlyArray<string>,
  shape: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!shape) return false;
  let current: unknown = shape;
  for (const seg of path) {
    if (current === null || current === undefined || typeof current !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(current, seg)) return false;
    current = (current as Record<string, unknown>)[seg];
  }
  return true;
}

function isNumericLit(n: ExprAst): boolean {
  return n.kind === 'lit' && typeof n.value === 'number';
}

function isStringLit(n: ExprAst): boolean {
  return n.kind === 'lit' && typeof n.value === 'string';
}

function isBoolLit(n: ExprAst): boolean {
  return n.kind === 'lit' && typeof n.value === 'boolean';
}

function checkBinop(node: Extract<ExprAst, { kind: 'binop' }>, errors: DslError[]): void {
  const op = node.op;
  const arith = op === '+' || op === '-' || op === '*' || op === '/' || op === '%';
  const compare = op === '<' || op === '<=' || op === '>' || op === '>=';
  const logical = op === '&&' || op === '||';
  // Only catch errors detectable from literal pairs. Identifier-shaped
  // operands are accepted (runtime will type-check).
  const bothLits = node.left.kind === 'lit' && node.right.kind === 'lit';
  if (!bothLits) return;

  if (arith && op !== '+') {
    // '+' is overloaded (numeric + string concat); other arith requires numeric.
    if (!isNumericLit(node.left) || !isNumericLit(node.right)) {
      errors.push({
        code: 'DSL_TYPE_ERROR',
        message: `operator '${op}' requires numeric operands`,
      });
    }
  }
  if (compare) {
    // numeric or both-string comparison
    const numNum = isNumericLit(node.left) && isNumericLit(node.right);
    const strStr = isStringLit(node.left) && isStringLit(node.right);
    if (!numNum && !strStr) {
      errors.push({
        code: 'DSL_TYPE_ERROR',
        message: `operator '${op}' requires both operands to be numbers or both strings`,
      });
    }
  }
  if (logical) {
    if (!isBoolLit(node.left) || !isBoolLit(node.right)) {
      errors.push({
        code: 'DSL_TYPE_ERROR',
        message: `operator '${op}' requires boolean operands`,
      });
    }
  }
}

function walk(node: ExprAst, hints: StaticCheckHints, errors: DslError[]): void {
  switch (node.kind) {
    case 'lit':
      return;
    case 'ident':
      if (hints.expectedScopeShape && !pathExistsInShape(node.path, hints.expectedScopeShape)) {
        errors.push({
          code: 'DSL_UNKNOWN_IDENTIFIER',
          message: `unknown identifier '${node.path.join('.')}'`,
        });
      }
      return;
    case 'binop':
      walk(node.left, hints, errors);
      walk(node.right, hints, errors);
      checkBinop(node, errors);
      return;
    case 'unop':
      walk(node.operand, hints, errors);
      if (node.op === '-' && node.operand.kind === 'lit' && !isNumericLit(node.operand)) {
        errors.push({ code: 'DSL_TYPE_ERROR', message: "unary '-' requires numeric operand" });
      }
      if (node.op === '!' && node.operand.kind === 'lit' && !isBoolLit(node.operand)) {
        errors.push({ code: 'DSL_TYPE_ERROR', message: "unary '!' requires boolean operand" });
      }
      return;
    case 'call': {
      for (const a of node.args) walk(a, hints, errors);
      if (!KNOWN_OP_NAMES.has(node.name)) {
        errors.push({
          code: 'DSL_UNKNOWN_IDENTIFIER',
          message: `unknown host op '${node.name}'`,
        });
      }
      return;
    }
    case 'pipe':
      walk(node.expr, hints, errors);
      for (const a of node.args) walk(a, hints, errors);
      if (!KNOWN_OP_NAMES.has(node.filter)) {
        errors.push({
          code: 'DSL_UNKNOWN_IDENTIFIER',
          message: `unknown filter '${node.filter}'`,
        });
      }
      return;
  }
}

/**
 * Walk the AST and return the list of static errors. Empty array = pass.
 */
export function staticCheck(ast: ExprAst, hints: StaticCheckHints): ReadonlyArray<DslError> {
  const errors: DslError[] = [];
  walk(ast, hints, errors);
  return errors;
}
