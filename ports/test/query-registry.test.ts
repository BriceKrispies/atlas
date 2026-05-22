/**
 * Tests for the in-port `createQueryRegistry()` reference implementation
 * + the `validateDescriptor` helper. Mirrors the cases in the
 * `queryRegistryContract` contract suite in `@atlas/contract-tests`
 * (which adapter-backed registries can run when they land); the cases
 * are duplicated here rather than imported because `@atlas/ports` does
 * not (and cannot) depend on `@atlas/contract-tests` (the contract suite
 * package depends on ports).
 *
 * Cases mirror `specs/crosscut/action-driven-routing.md` §4:
 *   1. Register + get round-trips the descriptor instance.
 *   2. list() returns descriptors in registration order.
 *   3. cacheKey omitting tenantId is rejected at register() time (§4.6).
 *   4. cacheKey returning null is accepted (the opt-out path per §4.6).
 *   5. Duplicate queryId is rejected (double-register policy = reject).
 *   6. queryId not matching `<Domain>.<Resource>.<Verb>` is rejected (§4.3).
 */
import { describe, test, expect, beforeEach } from '@atlas/test';
import type { QueryContext, QueryDescriptor, QueryRegistry } from '../src/index.ts';
import { createQueryRegistry, validateDescriptor, QUERY_ID_PATTERN } from '../src/index.ts';

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

describe('createQueryRegistry', function () {
  let registry: QueryRegistry;
  beforeEach(function () {
    registry = createQueryRegistry();
  });

  test('register then get returns the same descriptor instance', function () {
    const desc = makeDescriptor();
    registry.register(desc);
    expect(registry.get('Identity.Memberships.List')).toBe(desc);
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
    expect(
      registry.list().map(function (d) {
        return d.queryId;
      }),
    ).toEqual(['Identity.Memberships.List', 'Catalog.Family.Get', 'Authz.Policy.List']);
  });

  test('register rejects a cacheKey that omits tenantId from its returned key (§4.6 / I9)', function () {
    const desc = makeDescriptor({
      cacheKey: function (_ctx: QueryContext) {
        return 'Identity.Memberships:global';
      },
    });
    expect(function () {
      registry.register(desc);
    }).toThrow();
  });

  test('register accepts a cacheKey that includes tenantId literally', function () {
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
    const desc = makeDescriptor({
      cacheKey: function () {
        return null;
      },
    });
    expect(function () {
      registry.register(desc);
    }).not.toThrow();
    expect(registry.get('Identity.Memberships.List')).toBe(desc);
  });

  test('register rejects a duplicate queryId (double-register policy: reject)', function () {
    const first = makeDescriptor();
    const second = makeDescriptor({
      fn: async function () {
        return [{ id: 'shadow' }];
      },
    });
    registry.register(first);
    expect(function () {
      registry.register(second);
    }).toThrow();
    // Original survives the rejected duplicate.
    expect(registry.get('Identity.Memberships.List')).toBe(first);
  });

  test('register rejects a queryId that does not match <Domain>.<Resource>.<Verb> (§4.3)', function () {
    expect(function () {
      registry.register(makeDescriptor({ queryId: 'identity/memberships' }));
    }).toThrow();
    expect(function () {
      registry.register(makeDescriptor({ queryId: 'query.Identity.Memberships' }));
    }).toThrow();
    expect(function () {
      registry.register(makeDescriptor({ queryId: 'Identity.List' }));
    }).toThrow();
  });

  test('register rejects descriptors missing required fields', function () {
    // Empty actionId.
    expect(function () {
      registry.register(makeDescriptor({ actionId: '' }));
    }).toThrow();
    // Missing resource.type.
    expect(function () {
      registry.register(
        makeDescriptor({
          resource: {
            type: '',
            idFrom: function () {
              return '';
            },
          },
        }),
      );
    }).toThrow();
  });

  test('register surfaces a cacheKey() that throws on the smoke call', function () {
    const desc = makeDescriptor({
      cacheKey: function () {
        throw new Error('boom');
      },
    });
    expect(function () {
      registry.register(desc);
    }).toThrow();
  });
});

describe('QUERY_ID_PATTERN', function () {
  test('matches PascalCase 3- and 4-segment ids', function () {
    expect(QUERY_ID_PATTERN.test('Identity.Memberships.List')).toBe(true);
    expect(QUERY_ID_PATTERN.test('Catalog.Family.Variants.List')).toBe(true);
  });

  test('rejects URL-shaped, lowercase, or single-segment ids', function () {
    expect(QUERY_ID_PATTERN.test('identity/memberships')).toBe(false);
    expect(QUERY_ID_PATTERN.test('identity.memberships.list')).toBe(false);
    expect(QUERY_ID_PATTERN.test('Identity')).toBe(false);
    expect(QUERY_ID_PATTERN.test('Identity.List')).toBe(false);
    expect(QUERY_ID_PATTERN.test('query.Identity.Memberships.List')).toBe(false);
  });
});

describe('validateDescriptor (standalone helper)', function () {
  test('is callable independently of createQueryRegistry', function () {
    // Composing registries that aggregate per-module instances can call
    // validateDescriptor directly without instantiating a registry.
    expect(function () {
      validateDescriptor(makeDescriptor());
    }).not.toThrow();
  });
});
