/**
 * I9 — Cache Keys Include TenantId (property).
 *
 * @spec: specs/architecture.md#i9-cache-keys-include-tenantid
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * Invariant (universally quantified): for every cache write of a
 * tenant-scoped artifact, the literal `tenantId` appears in the key string
 * (testing.md §2.2). The `Cache` port itself is a flat KV — key namespacing
 * is the caller's job (see cache.ts contract). The thing under test is the
 * key-builder seam every tenant-scoped writer goes through.
 *
 * The seam is `adapters.cacheKeyFor(tenantId, artifactKind, artifactId,
 * dims)`. The property:
 *
 *   - builds a key for a generated tenant + artifact,
 *   - writes it through a real `Cache`,
 *   - asserts the key string CONTAINS the tenantId verbatim, AND
 *   - asserts two different tenants never collide on the same key (the
 *     point of the tenantId dimension — cross-tenant cache leakage, I9).
 *
 * A correct builder prefixes tenantId; a broken one omits it (so two
 * tenants writing the "same" artifact collide and leak).
 */
import fc from 'fast-check';
import type { Cache } from '@atlas/ports';
import { runConfig } from './_harness.ts';

export interface CacheKeyParts {
  tenantId: string;
  artifactKind: string;
  artifactId: string;
  dims: string[];
}

export interface I9Adapters {
  makeCache: () => Promise<Cache>;
  /** Build the cache key for a tenant-scoped artifact. */
  cacheKeyFor: (parts: CacheKeyParts) => string;
}

/** Reference correct key builder: tenantId is the first dimension (I9). */
export function tenantScopedKey(parts: CacheKeyParts): string {
  return [parts.tenantId, parts.artifactKind, parts.artifactId, ...parts.dims].join(':');
}

const partsArb: fc.Arbitrary<CacheKeyParts> = fc.record({
  // Tenant ids that include separators / each other as substrings, to
  // catch a builder that "contains tenantId by accident" via overlap.
  tenantId: fc.constantFrom('t', 'tenant-a', 'tenant-ab', 'a:b', 'x'),
  artifactKind: fc.constantFrom('summary', 'list', 'detail'),
  artifactId: fc.string({ minLength: 1, maxLength: 8 }),
  dims: fc.array(fc.string({ minLength: 0, maxLength: 4 }), { maxLength: 3 }),
});

export function runProperty(adapters: I9Adapters): Promise<void> {
  return fc.assert(
    fc.asyncProperty(partsArb, async function (parts) {
      const cache = await adapters.makeCache();
      const key = adapters.cacheKeyFor(parts);

      // (1) The literal tenantId MUST appear in the key string.
      if (!key.includes(parts.tenantId)) return false;

      // (2) Cross-tenant non-collision: the same artifact under a DIFFERENT
      // tenant MUST produce a different key, so a write under tenant X is
      // never readable under tenant Y. Pick a tenant guaranteed distinct.
      const otherTenant = parts.tenantId === 'x' ? 'tenant-a' : 'x';
      const otherKey = adapters.cacheKeyFor({ ...parts, tenantId: otherTenant });
      if (key === otherKey) return false;

      await cache.set(key, { tenant: parts.tenantId }, { ttlSeconds: 0, tags: [] });
      await cache.set(otherKey, { tenant: otherTenant }, { ttlSeconds: 0, tags: [] });
      // The two writes did not clobber each other.
      const got = await cache.get(key);
      if ((got as { tenant?: string } | null)?.tenant !== parts.tenantId) return false;

      return true;
    }),
    runConfig(),
  );
}
