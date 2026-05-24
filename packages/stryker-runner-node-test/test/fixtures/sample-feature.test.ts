/**
 * Tiny fixture used by the runner's integration test. Deliberately
 * minimal — three tests in one describe with deterministic behavior
 * (no env, no DB, no random). The fixture lives in the test tree so
 * Stryker doesn't try to mutate it; the integration test points
 * `node --test` at this path directly.
 */
import { describe, it, expect } from '@atlas/test';

describe('sample feature', function () {
  it('passes one', function () {
    expect(1 + 1).toBe(2);
  });

  it('passes two', function () {
    expect('atlas').toBe('atlas');
  });

  it('passes three', function () {
    expect([1, 2, 3].length).toBe(3);
  });
});
