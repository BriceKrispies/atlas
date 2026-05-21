/**
 * Handwritten recursive-descent parser for the expression DSL.
 *
 * Grammar (low precedence to high):
 *
 *   pipe       ::= or ('|' filterCall)*
 *   or         ::= and ('||' and)*
 *   and        ::= equality ('&&' equality)*
 *   equality   ::= comparison (('=='|'!=') comparison)*
 *   comparison ::= addition (('<'|'<='|'>'|'>=') addition)*
 *   addition   ::= multiplication (('+'|'-') multiplication)*
 *   multiplication ::= unary (('*'|'/'|'%') unary)*
 *   unary      ::= ('-'|'!') unary | primary
 *   primary    ::= literal | call | ident | '(' pipe ')'
 *   call       ::= ident '(' arglist? ')'
 *   arglist    ::= pipe (',' pipe)*
 *   ident      ::= identHead ('.' identHead)*
 *   identHead  ::= [a-zA-Z_][a-zA-Z0-9_]*
 *   literal    ::= number | string | boolean | 'null'
 *
 * Pipe is LEFT-ASSOCIATIVE and lowest precedence. `a + b | upper` parses
 * as `(a + b) | upper`. A filter call may take arguments:
 * `value | format("%.2f")` — args are expressions themselves (pipes
 * allowed inside via parens if needed; the top-level arg-list re-enters
 * at pipe-level so `format(a | upper)` is legal).
 *
 * No memory allocation games — the parser is a small state machine over
 * the source string. Source ranges are 1-based per the substrate's
 * `SourceRange` convention.
 */

import type { DslError, SourceMap, SourceRange } from '@atlas/dsl-substrate';
import type { ExprAst, BinOp, UnOp } from './ast.ts';

export interface ParseResult {
  readonly ast: ExprAst;
  readonly sourceMap: SourceMap;
}

interface Cursor {
  source: string;
  pos: number;
  line: number;
  col: number;
  // sourceMap accumulator
  map: { nodeId: string; range: SourceRange }[];
  // monotonic id counter
  nextId: number;
}

function makeCursor(source: string): Cursor {
  return { source, pos: 0, line: 1, col: 1, map: [], nextId: 0 };
}

function freshId(c: Cursor): string {
  const id = `n${c.nextId.toString(36)}`;
  c.nextId += 1;
  return id;
}

function snapshot(c: Cursor): { line: number; col: number; pos: number } {
  return { line: c.line, col: c.col, pos: c.pos };
}

function emitNode(
  c: Cursor,
  start: { line: number; col: number },
  end: { line: number; col: number },
): string {
  const id = freshId(c);
  c.map.push({
    nodeId: id,
    range: {
      startLine: start.line,
      startCol: start.col,
      endLine: end.line,
      endCol: end.col,
    },
  });
  return id;
}

function advance(c: Cursor, n: number): void {
  for (let i = 0; i < n; i += 1) {
    if (c.pos >= c.source.length) return;
    const ch = c.source[c.pos];
    c.pos += 1;
    if (ch === '\n') {
      c.line += 1;
      c.col = 1;
    } else {
      c.col += 1;
    }
  }
}

function peek(c: Cursor, offset = 0): string {
  return c.source[c.pos + offset] ?? '';
}

function isAtEnd(c: Cursor): boolean {
  return c.pos >= c.source.length;
}

function skipWhitespace(c: Cursor): void {
  while (!isAtEnd(c)) {
    const ch = peek(c);
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance(c, 1);
    } else {
      break;
    }
  }
}

function rangeFromTo(c: Cursor, start: { line: number; col: number }): SourceRange {
  return {
    startLine: start.line,
    startCol: start.col,
    endLine: c.line,
    endCol: c.col,
  };
}

class ParseError extends Error {
  readonly source: SourceRange;
  readonly code: DslError['code'];
  constructor(message: string, source: SourceRange, code: DslError['code'] = 'DSL_PARSE_ERROR') {
    super(message);
    this.source = source;
    this.code = code;
  }
}

function fail(c: Cursor, message: string, start?: { line: number; col: number }): never {
  const s = start ?? snapshot(c);
  throw new ParseError(message, rangeFromTo(c, s));
}

// ----- token-level helpers -----

function matchChar(c: Cursor, ch: string): boolean {
  if (peek(c) === ch) {
    advance(c, 1);
    return true;
  }
  return false;
}

function matchStr(c: Cursor, s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (peek(c, i) !== s[i]) return false;
  }
  advance(c, s.length);
  return true;
}

function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentChar(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function readIdentHead(c: Cursor): string {
  let s = '';
  while (!isAtEnd(c) && isIdentChar(peek(c))) {
    s += peek(c);
    advance(c, 1);
  }
  return s;
}

// ----- grammar productions -----

function parsePipe(c: Cursor): ExprAst {
  const start = snapshot(c);
  let left = parseOr(c);
  skipWhitespace(c);
  while (peek(c) === '|' && peek(c, 1) !== '|') {
    advance(c, 1); // consume '|'
    skipWhitespace(c);
    if (!isAlpha(peek(c))) {
      fail(c, "expected filter name after '|'");
    }
    const filterStart = snapshot(c);
    const filter = readIdentHead(c);
    skipWhitespace(c);
    const args: ExprAst[] = [];
    if (peek(c) === '(') {
      advance(c, 1);
      skipWhitespace(c);
      if (peek(c) !== ')') {
        args.push(parsePipe(c));
        skipWhitespace(c);
        while (peek(c) === ',') {
          advance(c, 1);
          skipWhitespace(c);
          args.push(parsePipe(c));
          skipWhitespace(c);
        }
      }
      if (peek(c) !== ')') {
        fail(c, "expected ')' after filter arguments", filterStart);
      }
      advance(c, 1);
    }
    skipWhitespace(c);
    const id = emitNode(c, start, snapshot(c));
    left = { kind: 'pipe', expr: left, filter, args, id };
  }
  return left;
}

function parseOr(c: Cursor): ExprAst {
  const start = snapshot(c);
  let left = parseAnd(c);
  skipWhitespace(c);
  while (matchStr(c, '||')) {
    skipWhitespace(c);
    const right = parseAnd(c);
    const id = emitNode(c, start, snapshot(c));
    left = { kind: 'binop', op: '||', left, right, id };
    skipWhitespace(c);
  }
  return left;
}

function parseAnd(c: Cursor): ExprAst {
  const start = snapshot(c);
  let left = parseEquality(c);
  skipWhitespace(c);
  while (matchStr(c, '&&')) {
    skipWhitespace(c);
    const right = parseEquality(c);
    const id = emitNode(c, start, snapshot(c));
    left = { kind: 'binop', op: '&&', left, right, id };
    skipWhitespace(c);
  }
  return left;
}

function parseEquality(c: Cursor): ExprAst {
  const start = snapshot(c);
  let left = parseComparison(c);
  skipWhitespace(c);
  for (;;) {
    let op: BinOp | null = null;
    if (matchStr(c, '==')) op = '==';
    else if (matchStr(c, '!=')) op = '!=';
    else break;
    skipWhitespace(c);
    const right = parseComparison(c);
    const id = emitNode(c, start, snapshot(c));
    left = { kind: 'binop', op, left, right, id };
    skipWhitespace(c);
  }
  return left;
}

function parseComparison(c: Cursor): ExprAst {
  const start = snapshot(c);
  let left = parseAddition(c);
  skipWhitespace(c);
  for (;;) {
    let op: BinOp | null = null;
    if (matchStr(c, '<=')) op = '<=';
    else if (matchStr(c, '>=')) op = '>=';
    else if (peek(c) === '<' && peek(c, 1) !== '<') {
      advance(c, 1);
      op = '<';
    } else if (peek(c) === '>' && peek(c, 1) !== '>') {
      advance(c, 1);
      op = '>';
    } else break;
    skipWhitespace(c);
    const right = parseAddition(c);
    const id = emitNode(c, start, snapshot(c));
    left = { kind: 'binop', op, left, right, id };
    skipWhitespace(c);
  }
  return left;
}

function parseAddition(c: Cursor): ExprAst {
  const start = snapshot(c);
  let left = parseMultiplication(c);
  skipWhitespace(c);
  for (;;) {
    let op: BinOp | null = null;
    if (peek(c) === '+') {
      advance(c, 1);
      op = '+';
    } else if (peek(c) === '-') {
      advance(c, 1);
      op = '-';
    } else break;
    skipWhitespace(c);
    const right = parseMultiplication(c);
    const id = emitNode(c, start, snapshot(c));
    left = { kind: 'binop', op, left, right, id };
    skipWhitespace(c);
  }
  return left;
}

function parseMultiplication(c: Cursor): ExprAst {
  const start = snapshot(c);
  let left = parseUnary(c);
  skipWhitespace(c);
  for (;;) {
    let op: BinOp | null = null;
    if (peek(c) === '*') {
      advance(c, 1);
      op = '*';
    } else if (peek(c) === '/') {
      advance(c, 1);
      op = '/';
    } else if (peek(c) === '%') {
      advance(c, 1);
      op = '%';
    } else break;
    skipWhitespace(c);
    const right = parseUnary(c);
    const id = emitNode(c, start, snapshot(c));
    left = { kind: 'binop', op, left, right, id };
    skipWhitespace(c);
  }
  return left;
}

function parseUnary(c: Cursor): ExprAst {
  skipWhitespace(c);
  const start = snapshot(c);
  let op: UnOp | null = null;
  if (peek(c) === '-' && !isDigit(peek(c, 1))) {
    advance(c, 1);
    op = '-';
  } else if (peek(c) === '!' && peek(c, 1) !== '=') {
    advance(c, 1);
    op = '!';
  }
  if (op !== null) {
    skipWhitespace(c);
    const operand = parseUnary(c);
    const id = emitNode(c, start, snapshot(c));
    return { kind: 'unop', op, operand, id };
  }
  return parsePrimary(c);
}

function parsePrimary(c: Cursor): ExprAst {
  skipWhitespace(c);
  const start = snapshot(c);
  if (isAtEnd(c)) fail(c, 'unexpected end of input');
  const ch = peek(c);

  // Parenthesised pipe
  if (ch === '(') {
    advance(c, 1);
    const inner = parsePipe(c);
    skipWhitespace(c);
    if (peek(c) !== ')') fail(c, "expected ')'");
    advance(c, 1);
    return inner;
  }

  // String literal
  if (ch === '"' || ch === "'") {
    const quote = ch;
    advance(c, 1);
    let value = '';
    while (!isAtEnd(c) && peek(c) !== quote) {
      if (peek(c) === '\\' && !isAtEnd(c)) {
        advance(c, 1);
        const esc = peek(c);
        advance(c, 1);
        if (esc === 'n') value += '\n';
        else if (esc === 't') value += '\t';
        else if (esc === 'r') value += '\r';
        else if (esc === '\\') value += '\\';
        else if (esc === quote) value += quote;
        else value += esc;
      } else {
        value += peek(c);
        advance(c, 1);
      }
    }
    if (isAtEnd(c)) fail(c, 'unterminated string literal', start);
    advance(c, 1); // close quote
    const id = emitNode(c, start, snapshot(c));
    return { kind: 'lit', value, id };
  }

  // Number literal
  if (isDigit(ch) || (ch === '-' && isDigit(peek(c, 1)))) {
    let s = '';
    if (ch === '-') {
      s += '-';
      advance(c, 1);
    }
    while (!isAtEnd(c) && isDigit(peek(c))) {
      s += peek(c);
      advance(c, 1);
    }
    if (peek(c) === '.' && isDigit(peek(c, 1))) {
      s += '.';
      advance(c, 1);
      while (!isAtEnd(c) && isDigit(peek(c))) {
        s += peek(c);
        advance(c, 1);
      }
    }
    const value = Number.parseFloat(s);
    if (!Number.isFinite(value)) fail(c, `bad number literal: '${s}'`, start);
    const id = emitNode(c, start, snapshot(c));
    return { kind: 'lit', value, id };
  }

  // Identifier / keyword / call
  if (isAlpha(ch)) {
    const head = readIdentHead(c);
    if (head === 'true' || head === 'false') {
      const id = emitNode(c, start, snapshot(c));
      return { kind: 'lit', value: head === 'true', id };
    }
    if (head === 'null') {
      const id = emitNode(c, start, snapshot(c));
      return { kind: 'lit', value: null, id };
    }
    // call or dot-path ident
    skipWhitespace(c);
    if (peek(c) === '(') {
      advance(c, 1);
      skipWhitespace(c);
      const args: ExprAst[] = [];
      if (peek(c) !== ')') {
        args.push(parsePipe(c));
        skipWhitespace(c);
        while (peek(c) === ',') {
          advance(c, 1);
          skipWhitespace(c);
          args.push(parsePipe(c));
          skipWhitespace(c);
        }
      }
      if (peek(c) !== ')') fail(c, "expected ')' after call arguments", start);
      advance(c, 1);
      const id = emitNode(c, start, snapshot(c));
      return { kind: 'call', name: head, args, id };
    }
    // dot-path ident
    const path: string[] = [head];
    while (peek(c) === '.' && isAlpha(peek(c, 1))) {
      advance(c, 1);
      const next = readIdentHead(c);
      path.push(next);
    }
    const id = emitNode(c, start, snapshot(c));
    return { kind: 'ident', path, id };
  }

  fail(c, `unexpected character '${ch}'`);
}

/**
 * Parse an expression-DSL source string into `{ ast, sourceMap }`. Returns a
 * substrate-shaped `Result<ParseResult, DslError>` on failure — no throws.
 */
export function parse(
  source: string,
): { ok: true; value: ParseResult } | { ok: false; error: DslError } {
  const c = makeCursor(source);
  try {
    skipWhitespace(c);
    if (isAtEnd(c)) {
      return {
        ok: false,
        error: {
          code: 'DSL_PARSE_ERROR',
          message: 'empty expression',
          sourceRange: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        },
      };
    }
    const ast = parsePipe(c);
    skipWhitespace(c);
    if (!isAtEnd(c)) {
      const remaining = c.source.slice(c.pos).trim();
      return {
        ok: false,
        error: {
          code: 'DSL_PARSE_ERROR',
          message: `unexpected trailing input: '${remaining.slice(0, 24)}'`,
          sourceRange: {
            startLine: c.line,
            startCol: c.col,
            endLine: c.line,
            endCol: c.col + remaining.length,
          },
        },
      };
    }
    return { ok: true, value: { ast, sourceMap: c.map } };
  } catch (e) {
    if (e instanceof ParseError) {
      return {
        ok: false,
        error: {
          code: e.code,
          message: e.message,
          sourceRange: e.source,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: 'DSL_PARSE_ERROR',
        message: (e as Error).message,
      },
    };
  }
}
