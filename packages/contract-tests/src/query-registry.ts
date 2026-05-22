import { describe, test, expect, beforeEach } from '@atlas/test';
import type {
  QueryContext,
  QueryDescriptor,
  QueryRegistry,
} from '@atlas/ports';
import { assertDefined } from '@atlas/test-fixtures/assert';

/**
 * Contract suite for `QueryRegistry` — exercises the rules in
 * `specs/crosscut/action-driven-routing.md` §4.1 / §4.6 + the lexicon
 * entries for `QueryRegistry`, `QueryDescriptor`, and `queryId`. Any
 * implementation of the port (the default `createQueryRegistry()` from
 * `@atlas/ports`, plus any future adapter-backed registry) MUST pass.
 *
 * Cases:
 *   1. Register a descriptor; `get(queryId)` returns it.
 *   2. `list()` returns registered descriptors in stable registration order.
 *   3. Registration rejects a `cacheKey` whose returned key shape does
 *      not include `tenantId` literally (I9 smoke check, §4.6).
 *   4. Registration accepts a `cacheKey` that returns `null` — the
 *      opt-out path per the design doc decision #6 / §4.6.
 *   5. Double-registering the same `queryId` is rejected (the safer
 *      default — see `createQueryRegistry`'s doc-comment).
 */
export function queryRegistryContract(
  makeRegistry: () => Promise<QueryRegistry>,
): void {
  describe('QueryRegistry contract', function () {
    let registry: QueryRegistry;
    beforeEach(async function () {
      registry = await makeRegistry();
    });

    function makeDescriptor(overrides: Partial<QueryDescriptor> = {}): QueryDescriptor {
      const base: QueryDescriptor = {
        queryId: 'Identity.Memberships.List',
        actionId: 'Identity.Memberships.List',
        resource: {
          type: 'Membership',
          idFrom: function () {
            return '';
          },
        },
        fn: async function () {
          return [];
        },
      };
      return { ...base, ...overrides };
    }

    test('register then get returns the same descriptor instance', function () {
      const desc = makeDescriptor();
      registry.register(desc);
      const fetched = assertDefined(
        registry.get('Identity.Memberships.List'),
        'get should return the registered descriptor',
      );
      expect(fetched).toBe(desc);
    });

    test('get returns undefined for an unregistered queryId', function () {
      expect(registry.get('Made.Up.Query')).toBeUndefined();
    });

    test('list returns registered descriptors in registration order', function () {
      const a = makeDescriptor({ queryId: 'Identity.Memberships.List' });
      const b = makeDescriptor({
        queryId: 'Catalog.Family.Get',
        actionId: 'Catalog.Family.Get',
        resource: {
          type: 'Family',
          idFrom: function (p) {
            return String(p['familyKey'] ?? '');
          },
        },
      });
      const c = makeDescriptor({
        queryId: 'Authz.Policy.List',
        actionId: 'Authz.Policy.List',
        resource: {
          type: 'Policy',
          idFrom: function () {
            return '';
          },
        },
      });
      registry.register(a);
      registry.register(b);
      registry.register(c);
      const ids = registry.list().map(function (d) {
        return d.queryId;
      });
      expect(ids).toEqual([
        'Identity.Memberships.List',
        'Catalog.Family.Get',
        'Authz.Policy.List',
      ]);
    });

    test('register rejects a cacheKey that omits tenantId from its returned key', function () {
      // The cacheKey below builds a key that intentionally leaves
      // tenantId out. Per §4.6 this violates I9 and the registry's
      // registration-time smoke check must catch it.
      const desc = makeDescriptor({
        cacheKey: function (_ctx: QueryContext, _params) {
          return 'Identity.Memberships:global';
        },
      });
      expect(function () {
        registry.register(desc);
      }).toThrow();
    });

    test('register accepts a cacheKey that includes tenantId literally in its returned key', function () {
      const desc = makeDescriptor({
        cacheKey: function (ctx: QueryContext) {
          return `Identity.Memberships:${ctx.tenantId}`;
        },
      });
      expect(function () {
        registry.register(desc);
      }).not.toThrow();
    });

    test('register accepts a cacheKey that returns null (opt-out per §4.6)', function () {
      // Per §4.6: returning null opts the query out of caching. The
      // smoke check must not reject this path.
      const desc = makeDescriptor({
        cacheKey: function () {
          return null;
        },
      });
      expect(function () {
        registry.register(desc);
      }).not.toThrow();
      // And it should be retrievable afterwards.
      expect(registry.get('Identity.Memberships.List')).toBe(desc);
    });

    test('register rejects a duplicate queryId (double-register policy: reject)', function () {
      // Decision: reject is the safer default. Two modules accidentally
      // clobbering each other under a silent-replace policy would
      // surprise the catch-all consumer. See `createQueryRegistry`'s
      // doc-comment for the full reasoning.
      const first = makeDescriptor();
      const second = makeDescriptor({
        // Same queryId, different fn — would be a silent clobber under replace.
        fn: async function () {
          return [{ id: 'shadow' }];
        },
      });
      registry.register(first);
      expect(function () {
        registry.register(second);
      }).toThrow();
      // The original registration survives the rejected duplicate.
      expect(registry.get('Identity.Memberships.List')).toBe(first);
    });

    test('register rejects a queryId that does not match <Domain>.<Resource>.<Verb>', function () {
      // §4.3 / lexicon: URL-shaped ids and `query.*` prefixes are
      // explicitly rejected at registration time.
      const urlShaped = makeDescriptor({ queryId: 'identity/memberships' });
      expect(function () {
        registry.register(urlShaped);
      }).toThrow();

      const prefixed = makeDescriptor({ queryId: 'query.Identity.Memberships' });
      expect(function () {
        registry.register(prefixed);
      }).toThrow();

      const tooShort = makeDescriptor({ queryId: 'Identity.List' });
      expect(function () {
        registry.register(tooShort);
      }).toThrow();
    });
  });
}
