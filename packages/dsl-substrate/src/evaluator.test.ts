import { describe, expect, it } from '@atlas/test';
import type { Result } from './evaluator.ts';
import { ok, err } from './contract-tests.ts';
import { dslUpdateAction } from './intent.ts';
import {
  DSL_TABLE_PREFIX,
  DSL_VERSIONS_TABLE_SUFFIX,
  DSL_KIND_PATTERN,
  dslTableName,
  dslVersionsTableName,
} from './storage.ts';

/**
 * Result-type ergonomics + small-helper assertions.
 *
 * The evaluator's "purity by signature" guarantee depends on
 * `Result<T, E>` discriminating cleanly between ok/err. These tests prove
 * the discrimination compiles and behaves at runtime; the real evaluator
 * (slice #3) builds on this.
 *
 * Also covers the small pure helpers in `./intent.ts` and `./storage.ts`,
 * since they're the only runtime code in slice #1 and need their own
 * assertions.
 */

describe('Result<T, E>', function () {
  it('ok constructor produces ok-shaped value', function () {
    const r: Result<number, string> = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(42);
    } else {
      throw new Error('expected ok branch');
    }
  });

  it('err constructor produces err-shaped value', function () {
    const r: Result<number, string> = err('boom');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('boom');
    } else {
      throw new Error('expected err branch');
    }
  });

  it('narrowing via discriminant works in both branches', function () {
    const samples: ReadonlyArray<Result<string, number>> = [ok('hello'), err(7)];
    const summarised = samples.map(function (s) {
      return s.ok ? `ok:${s.value}` : `err:${s.error.toString()}`;
    });
    expect(summarised).toEqual(['ok:hello', 'err:7']);
  });
});

describe('dslUpdateAction', function () {
  it('composes the canonical Dsl.<Kind>.Update string', function () {
    expect(dslUpdateAction('expression')).toBe('Dsl.Expression.Update');
    expect(dslUpdateAction('template')).toBe('Dsl.Template.Update');
    expect(dslUpdateAction('query')).toBe('Dsl.Query.Update');
  });

  it('handles single-char kinds and the empty string defensively', function () {
    expect(dslUpdateAction('x')).toBe('Dsl.X.Update');
    expect(dslUpdateAction('')).toBe('Dsl..Update');
  });
});

describe('storage conventions', function () {
  it('dslTableName composes the _atlas_dsl_<kind> name', function () {
    expect(dslTableName('expression')).toBe('_atlas_dsl_expression');
    expect(dslTableName('query')).toBe('_atlas_dsl_query');
  });

  it('dslVersionsTableName appends _versions', function () {
    expect(dslVersionsTableName('expression')).toBe('_atlas_dsl_expression_versions');
  });

  it('DSL_KIND_PATTERN accepts lowercase snake-case starting with a letter', function () {
    expect(DSL_KIND_PATTERN.test('expression')).toBe(true);
    expect(DSL_KIND_PATTERN.test('formula_field')).toBe(true);
    expect(DSL_KIND_PATTERN.test('q1')).toBe(true);
  });

  it('DSL_KIND_PATTERN rejects uppercase, leading digits, and hyphens', function () {
    expect(DSL_KIND_PATTERN.test('Expression')).toBe(false);
    expect(DSL_KIND_PATTERN.test('1query')).toBe(false);
    expect(DSL_KIND_PATTERN.test('formula-field')).toBe(false);
    expect(DSL_KIND_PATTERN.test('x')).toBe(false); // length 1 disallowed; needs 2+
  });

  it('exports the prefix and suffix constants for downstream slices', function () {
    expect(DSL_TABLE_PREFIX).toBe('_atlas_dsl_');
    expect(DSL_VERSIONS_TABLE_SUFFIX).toBe('_versions');
  });
});
