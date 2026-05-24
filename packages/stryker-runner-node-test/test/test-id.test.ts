/**
 * Test-ID contract — load-bearing for parity with the command runner.
 *
 * The native plugin's killedBy IDs are richer than the command runner's
 * (which uses `["0"]` for every kill — see oracle baseline). What
 * matters here is that the SAME describe/it produces the SAME ID
 * across calls — Stryker's coverage→mutant mapping breaks otherwise.
 *
 * Strict TDD: tests fail until `src/test-id.ts` is implemented.
 */
import { describe, it, expect } from '@atlas/test';
import { makeTestId } from '../src/test-id.ts';

describe('makeTestId', function () {
  it('formats a top-level test with empty describe path', function () {
    const id = makeTestId({
      filePath: 'modules/identity/test/handlers.test.ts',
      describePath: [],
      itName: 'happy path',
    });
    expect(id).toBe('modules/identity/test/handlers.test.ts::::happy path');
  });

  it('formats a single-level describe', function () {
    const id = makeTestId({
      filePath: 'modules/identity/test/handlers.test.ts',
      describePath: ['Identity.User.Create'],
      itName: 'emits UserCreated with platform + tenant cache tags',
    });
    expect(id).toBe(
      'modules/identity/test/handlers.test.ts::Identity.User.Create::emits UserCreated with platform + tenant cache tags',
    );
  });

  it('joins nested describe levels with " > "', function () {
    const id = makeTestId({
      filePath: 'a/b.test.ts',
      describePath: ['Outer', 'Inner', 'Deeper'],
      itName: 'thing',
    });
    expect(id).toBe('a/b.test.ts::Outer > Inner > Deeper::thing');
  });

  it('is deterministic — same input yields same output', function () {
    const parts = {
      filePath: 'x.test.ts',
      describePath: ['A', 'B'],
      itName: 'name',
    };
    expect(makeTestId(parts)).toBe(makeTestId(parts));
  });

  it('treats two distinct inputs as distinct IDs', function () {
    const a = makeTestId({
      filePath: 'x.test.ts',
      describePath: ['A'],
      itName: 'one',
    });
    const b = makeTestId({
      filePath: 'x.test.ts',
      describePath: ['A'],
      itName: 'two',
    });
    expect(a).not.toBe(b);
  });

  it('treats different file paths as distinct even with identical describe/it', function () {
    const a = makeTestId({
      filePath: 'a.test.ts',
      describePath: ['D'],
      itName: 'i',
    });
    const b = makeTestId({
      filePath: 'b.test.ts',
      describePath: ['D'],
      itName: 'i',
    });
    expect(a).not.toBe(b);
  });
});
