/**
 * Self-test for the I10 event-driven cache-invalidation property.
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 * @spec: specs/architecture.md#i10-event-driven-cache-invalidation
 */
import { describe, test } from '@atlas/test';
import type { Cache } from '@atlas/ports';
import { runProperty, invalidateByEventTags } from './i10-cache-invalidation.ts';
import {
  expectPropertyToCatchViolation,
  expectPropertyToHold,
} from './_self-test.ts';
import { MemCache } from './_fakes.ts';

/** BROKEN dispatcher: ignores the event's tags — never purges. Violates I10. */
async function noopInvalidate(_cache: Cache, _tags: string[]): Promise<number> {
  return 0;
}

const makeCache = async () => new MemCache();

describe('I10 event-driven cache-invalidation property', function () {
  test('holds when the dispatcher purges by the event tags', async function () {
    await expectPropertyToHold(() =>
      runProperty({ makeCache, invalidateForEvent: invalidateByEventTags }),
    );
  });

  test('catches + shrinks a dispatcher that drops event tags (stale cache)', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({ makeCache, invalidateForEvent: noopInvalidate }),
    );
  });
});
