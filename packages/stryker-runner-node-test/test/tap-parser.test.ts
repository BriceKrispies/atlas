/**
 * TAP-14 parser unit tests.
 *
 * Fixtures are inline strings approximating node:test's `--test-reporter=tap`
 * output. Real samples were captured via
 * `node --test --test-reporter=tap modules/identity/test/handlers.test.ts`
 * and minimised to the relevant shapes (one-suite, nested, failing,
 * skipped).
 *
 * Strict TDD: tests fail until `src/tap-parser.ts` is implemented.
 */
import { describe, it, expect } from '@atlas/test';
import { createTapParser, type TapEvent } from '../src/tap-parser.ts';

function runParser(lines: readonly string[]): readonly TapEvent[] {
  const p = createTapParser();
  for (const ln of lines) p.feed(ln);
  return p.drain();
}

describe('createTapParser', function () {
  it('parses a single passing test', function () {
    const events = runParser([
      'TAP version 14',
      '# Subtest: passes',
      'ok 1 - passes',
      '  ---',
      '  duration_ms: 1.5',
      '  ...',
      '1..1',
      '# tests 1',
      '# pass 1',
    ]);
    const tests = events.filter(function (e) {
      return e.kind === 'test';
    });
    expect(tests.length).toBe(1);
    const t = tests[0]!;
    expect(t.kind).toBe('test');
    if (t.kind !== 'test') return;
    expect(t.status).toBe('pass');
    expect(t.name).toEqual(['passes']);
    expect(t.durationMs).toBe(1.5);
    expect(t.failure).toBe(null);
  });

  it('parses a single failing test with a YAML error block', function () {
    const events = runParser([
      'TAP version 14',
      '# Subtest: blows up',
      'not ok 1 - blows up',
      '  ---',
      '  duration_ms: 0.7',
      '  failureType: testCodeFailure',
      '  error: \'something broke\'',
      '  stack: |-',
      '    at TestContext.<anonymous> (foo.test.ts:10:5)',
      '    at Test.run (node:test:1)',
      '  ...',
      '1..1',
    ]);
    const tests = events.filter(function (e) {
      return e.kind === 'test';
    });
    expect(tests.length).toBe(1);
    const t = tests[0]!;
    if (t.kind !== 'test') return;
    expect(t.status).toBe('fail');
    expect(t.name).toEqual(['blows up']);
    expect(t.failure).not.toBe(null);
    expect(t.failure!.message).toContain('something broke');
    expect(t.failure!.stack).not.toBe(null);
    expect(t.failure!.stack!).toContain('TestContext.<anonymous>');
  });

  it('parses a skipped test (ok ... # SKIP)', function () {
    const events = runParser([
      'TAP version 14',
      'ok 1 - boring # SKIP',
      '1..1',
    ]);
    const tests = events.filter(function (e) {
      return e.kind === 'test';
    });
    expect(tests.length).toBe(1);
    const t = tests[0]!;
    if (t.kind !== 'test') return;
    expect(t.status).toBe('skip');
    expect(t.name).toEqual(['boring']);
  });

  it('tracks nested describes via indentation', function () {
    const events = runParser([
      'TAP version 14',
      '# Subtest: Outer',
      '    # Subtest: inner test',
      '    ok 1 - inner test',
      '      ---',
      '      duration_ms: 2',
      '      ...',
      '    1..1',
      'ok 1 - Outer',
      '  ---',
      '  duration_ms: 3',
      '  ...',
      '1..1',
    ]);
    const tests = events.filter(function (e) {
      return e.kind === 'test';
    });
    // Suite-level "Outer" passes too — node:test reports it as a
    // distinct test. The parser keeps both but the consumer can
    // filter on `name.length > 1` if it wants leaf-only.
    const leaf = tests.find(function (e) {
      return e.kind === 'test' && e.name.length === 2;
    });
    expect(leaf).not.toBe(undefined);
    if (!leaf || leaf.kind !== 'test') return;
    expect(leaf.name).toEqual(['Outer', 'inner test']);
    expect(leaf.status).toBe('pass');
  });

  it('handles deep nesting (three describe levels)', function () {
    const events = runParser([
      'TAP version 14',
      '# Subtest: A',
      '    # Subtest: B',
      '        # Subtest: leaf',
      '        ok 1 - leaf',
      '        1..1',
      '    ok 1 - B',
      '    1..1',
      'ok 1 - A',
      '1..1',
    ]);
    const leaf = events.find(function (e) {
      return e.kind === 'test' && e.name.length === 3;
    });
    expect(leaf).not.toBe(undefined);
    if (!leaf || leaf.kind !== 'test') return;
    expect(leaf.name).toEqual(['A', 'B', 'leaf']);
  });

  it('drain() returns an empty array when fed nothing meaningful', function () {
    const events = runParser(['TAP version 14', '1..0']);
    expect(events.filter(function (e) {
      return e.kind === 'test';
    }).length).toBe(0);
  });
});
