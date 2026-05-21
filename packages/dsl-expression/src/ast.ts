/**
 * AST shape for the expression DSL.
 *
 * Tagged-union nodes with a stable `id` per node so the parser's
 * `SourceMap` can address each one. Closed semantics — adding a node
 * kind requires a spec change.
 *
 * No statements, no loops, no function definitions, no recursion at the
 * language level — recursion can only enter via host ops, which are
 * themselves bounded by the substrate's budget. This is the structural
 * shape of ADR 0007 §2 property 1 (non-Turing-complete).
 */

export type BinOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||';

export type UnOp = '-' | '!';

export type ExprAst =
  | { readonly kind: 'lit'; readonly value: string | number | boolean | null; readonly id: string }
  | { readonly kind: 'ident'; readonly path: ReadonlyArray<string>; readonly id: string }
  | {
      readonly kind: 'binop';
      readonly op: BinOp;
      readonly left: ExprAst;
      readonly right: ExprAst;
      readonly id: string;
    }
  | { readonly kind: 'unop'; readonly op: UnOp; readonly operand: ExprAst; readonly id: string }
  | {
      readonly kind: 'call';
      readonly name: string;
      readonly args: ReadonlyArray<ExprAst>;
      readonly id: string;
    }
  | {
      readonly kind: 'pipe';
      readonly expr: ExprAst;
      readonly filter: string;
      readonly args: ReadonlyArray<ExprAst>;
      readonly id: string;
    };

/**
 * Output type for an evaluated expression. Same shape as a literal.
 * Object / array outputs aren't supported in v1 — the host scope can
 * carry them as inputs (via dot-path identifiers), but the expression
 * grammar can only produce primitives.
 */
export type ExprValue = string | number | boolean | null;

/**
 * Per-evaluation scope. A nested object the dot-path identifier (`user.name`)
 * walks. Values may be any type at the wire layer; the static checker and
 * evaluator narrow as they descend.
 */
export type ExprScope = Readonly<Record<string, unknown>>;
