/**
 * Self-test for the I9 cache-key tenant-scope property ("test the test").
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 * @spec: specs/architecture.md#i9-cache-keys-include-tenantid
 */
import { describe, test } from '@atlas/test';
import {
  runProperty,
  tenantScopedKey,
  type CacheKeyParts,
} from './i9-cache-tenant-scope.ts';
import {
  expectPropertyToCatchViolation,
  expectPropertyToHold,
} from './_self-test.ts';
import { MemCache } from './_fakes.ts';

/** BROKEN builder: omits tenantId — two tenants collide. Violates I9. */
function tenantBlindKey(parts: CacheKeyParts): string {
  return [parts.artifactKind, parts.artifactId, ...parts.dims].join(':');
}

const makeCache = async () => new MemCache();

describe('I9 cache-key tenant-scope property', function () {
  test('holds for a tenant-prefixed key builder', async function () {
    await expectPropertyToHold(() =>
      runProperty({ makeCache, cacheKeyFor: tenantScopedKey }),
    );
  });

  test('catches + shrinks a builder that omits tenantId', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({ makeCache, cacheKeyFor: tenantBlindKey }),
    );
  });
});
