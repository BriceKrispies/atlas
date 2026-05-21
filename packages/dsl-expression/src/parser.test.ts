import { describe, expect, it } from '@atlas/test';
import { parse } from './parser.ts';

/**
 * Parser tests. Covers the grammar shape — primary expressions,
 * precedence, associativity, error reporting with source ranges.
 */

function parseOk(source: string) {
  const r = parse(source);
  if (!r.ok) {
    throw new Error(`expected ok, got error: ${r.error.code} ${r.error.message}`);
  }
  return r.value;
}

function parseErr(source: string) {
  const r = parse(source);
  if (r.ok) {
    throw new Error(`expected error, got ok for '${source}'`);
  }
  return r.error;
}

describe('parser — literals', function () {
  it('parses integer literals', function () {
    const { ast } = parseOk('42');
    expect(ast.kind).toBe('lit');
    if (ast.kind === 'lit') expect(ast.value).toBe(42);
  });
  it('parses float literals', function () {
    const { ast } = parseOk('3.14');
    if (ast.kind === 'lit') expect(ast.value).toBe(3.14);
  });
  it('parses string literals with double quotes', function () {
    const { ast } = parseOk('"hello"');
    if (ast.kind === 'lit') expect(ast.value).toBe('hello');
  });
  it('parses string literals with single quotes', function () {
    const { ast } = parseOk("'hello'");
    if (ast.kind === 'lit') expect(ast.value).toBe('hello');
  });
  it('parses string literals with escape sequences', function () {
    const { ast } = parseOk('"a\\nb"');
    if (ast.kind === 'lit') expect(ast.value).toBe('a\nb');
  });
  it('parses boolean literals', function () {
    expect(parseOk('true').ast).toEqual(expect.objectContaining({ kind: 'lit', value: true }));
    expect(parseOk('false').ast).toEqual(expect.objectContaining({ kind: 'lit', value: false }));
  });
  it('parses null literal', function () {
    expect(parseOk('null').ast).toEqual(expect.objectContaining({ kind: 'lit', value: null }));
  });
});

describe('parser — identifiers', function () {
  it('parses single-segment identifier', function () {
    const { ast } = parseOk('user');
    expect(ast.kind).toBe('ident');
    if (ast.kind === 'ident') expect(ast.path).toEqual(['user']);
  });
  it('parses dot-path identifier', function () {
    const { ast } = parseOk('user.name');
    if (ast.kind === 'ident') expect(ast.path).toEqual(['user', 'name']);
  });
  it('parses deeply nested dot-path', function () {
    const { ast } = parseOk('a.b.c.d');
    if (ast.kind === 'ident') expect(ast.path).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('parser — operators', function () {
  it('parses arithmetic with correct precedence', function () {
    // 2 + 3 * 4 = 14 (multiplication binds tighter)
    const { ast } = parseOk('2 + 3 * 4');
    expect(ast.kind).toBe('binop');
    if (ast.kind === 'binop') {
      expect(ast.op).toBe('+');
      expect(ast.left.kind).toBe('lit');
      expect(ast.right.kind).toBe('binop');
      if (ast.right.kind === 'binop') expect(ast.right.op).toBe('*');
    }
  });
  it('parses parens to override precedence', function () {
    // (2 + 3) * 4
    const { ast } = parseOk('(2 + 3) * 4');
    if (ast.kind === 'binop') {
      expect(ast.op).toBe('*');
      expect(ast.left.kind).toBe('binop');
      if (ast.left.kind === 'binop') expect(ast.left.op).toBe('+');
    }
  });
  it('parses comparison ops', function () {
    const { ast } = parseOk('a < b');
    if (ast.kind === 'binop') expect(ast.op).toBe('<');
  });
  it('parses equality ops', function () {
    const { ast } = parseOk('a == b');
    if (ast.kind === 'binop') expect(ast.op).toBe('==');
  });
  it('parses logical ops', function () {
    const { ast } = parseOk('a && b || c');
    // && binds tighter than ||
    if (ast.kind === 'binop') {
      expect(ast.op).toBe('||');
      expect(ast.left.kind).toBe('binop');
      if (ast.left.kind === 'binop') expect(ast.left.op).toBe('&&');
    }
  });
  it('parses unary minus', function () {
    const { ast } = parseOk('-x');
    expect(ast.kind).toBe('unop');
    if (ast.kind === 'unop') expect(ast.op).toBe('-');
  });
  it('parses unary not', function () {
    const { ast } = parseOk('!x');
    if (ast.kind === 'unop') expect(ast.op).toBe('!');
  });
});

describe('parser — calls', function () {
  it('parses zero-arg call', function () {
    const { ast } = parseOk('now()');
    expect(ast.kind).toBe('call');
    if (ast.kind === 'call') {
      expect(ast.name).toBe('now');
      expect(ast.args).toEqual([]);
    }
  });
  it('parses single-arg call', function () {
    const { ast } = parseOk('upper("hello")');
    if (ast.kind === 'call') {
      expect(ast.name).toBe('upper');
      expect(ast.args.length).toBe(1);
    }
  });
  it('parses multi-arg call', function () {
    const { ast } = parseOk('format("%s-%d", "abc", 42)');
    if (ast.kind === 'call') {
      expect(ast.name).toBe('format');
      expect(ast.args.length).toBe(3);
    }
  });
});

describe('parser — pipes', function () {
  it('parses single pipe', function () {
    const { ast } = parseOk('name | upper');
    expect(ast.kind).toBe('pipe');
    if (ast.kind === 'pipe') {
      expect(ast.filter).toBe('upper');
      expect(ast.args).toEqual([]);
    }
  });
  it('parses pipe chain', function () {
    const { ast } = parseOk('name | trim | upper');
    if (ast.kind === 'pipe') {
      expect(ast.filter).toBe('upper');
      // left side is also a pipe (trim)
      expect(ast.expr.kind).toBe('pipe');
    }
  });
  it('parses pipe with args', function () {
    const { ast } = parseOk('value | format("%.2f")');
    if (ast.kind === 'pipe') {
      expect(ast.filter).toBe('format');
      expect(ast.args.length).toBe(1);
    }
  });
  it('pipe binds less tightly than binops', function () {
    // a + b | upper parses as (a + b) | upper
    const { ast } = parseOk('a + b | upper');
    if (ast.kind === 'pipe') {
      expect(ast.filter).toBe('upper');
      expect(ast.expr.kind).toBe('binop');
    }
  });
});

describe('parser — sourceMap', function () {
  it('emits one entry per AST node', function () {
    const { ast, sourceMap } = parseOk('a + b');
    // Three nodes: ident a, ident b, binop +
    expect(sourceMap.length).toBe(3);
    expect(sourceMap.every((m) => typeof m.nodeId === 'string')).toBe(true);
    expect(sourceMap.every((m) => m.range.startLine === 1)).toBe(true);
    // The binop node should have an id matching the root AST node.
    const rootEntry = sourceMap.find((m) => m.nodeId === ast.id);
    expect(rootEntry).toBeDefined();
  });
});

describe('parser — error reporting', function () {
  it('reports unterminated string with source range', function () {
    const err = parseErr('"abc');
    expect(err.code).toBe('DSL_PARSE_ERROR');
    expect(err.message).toMatch(/unterminated/);
    expect(err.sourceRange).toBeDefined();
  });
  it('reports unexpected end of input', function () {
    const err = parseErr('a +');
    expect(err.code).toBe('DSL_PARSE_ERROR');
  });
  it('reports empty input', function () {
    const err = parseErr('   ');
    expect(err.code).toBe('DSL_PARSE_ERROR');
    expect(err.message).toMatch(/empty/);
  });
  it('reports trailing input', function () {
    const err = parseErr('a b');
    expect(err.code).toBe('DSL_PARSE_ERROR');
    expect(err.message).toMatch(/trailing/);
  });
});
