import { describe, test, expect, beforeEach, afterEach } from '@atlas/test';
import type { ActionEntry, ControlPlaneRegistry } from '@atlas/ports';
import { assertDefined } from '@atlas/test-fixtures/assert';

/**
 * A registry document the control plane stores, keyed by
 * `(schemaId, schemaVersion)`. Mirrors the `control_plane.intent_schemas`
 * row shape from
 * `specs/domains/runtime/capabilities/control-plane-schema-registry/README.md`
 * §"Control-Plane Storage Shape".
 */
export interface SchemaRegistryDoc {
  schemaId: string;
  schemaVersion: number;
  /** ajv-compilable JSON Schema document. */
  document: Record<string, unknown>;
  /** 'seed' (from bundle) or 'registered' (runtime write). */
  source?: 'seed' | 'registered';
}

/**
 * The control-plane write seam the dynamic-registration contract drives.
 *
 * The `ControlPlaneRegistry` port stays sync (decision O1); a registry row
 * is written through this out-of-band harness (a plain control-plane write
 * for this slice), then the adapter's process-local snapshot refreshes on
 * the version cursor and the row becomes resolvable via the sync port
 * methods. The harness exposes the registry under test plus the writer the
 * test uses to register schemas/actions at runtime.
 *
 * @see specs/domains/runtime/capabilities/control-plane-schema-registry/README.md §"Hot-registration contract"
 */
export interface DynamicRegistryHarness {
  /** The registry under test (sync port surface). */
  readonly registry: ControlPlaneRegistry;
  /**
   * Write a schema document row to the control plane (out-of-band of the
   * sync port). After this resolves, the registry MUST observe the new row
   * on the next lookup (`getSchemaValidator`) — same process, no restart.
   * `source` defaults to `'registered'`.
   */
  registerSchema(doc: SchemaRegistryDoc): Promise<void>;
  /**
   * Write an action-entry row to the control plane (out-of-band of the sync
   * port). After this resolves, the registry MUST observe it on the next
   * `getAction`/`hasAction`.
   */
  registerAction(entry: ActionEntry & { source?: 'seed' | 'registered' }): Promise<void>;
  /**
   * Run the idempotent first-boot seed of the bundled `@atlas/schemas` set.
   * Re-running MUST be a no-op and MUST NOT overwrite a `source='registered'`
   * row. Returns the schema docs the seed considers authoritative for the
   * given key, so the test can assert a registered row survived a re-seed.
   */
  reseed(): Promise<void>;
  /**
   * Read back the persisted source tag for a `(schemaId, schemaVersion)`
   * row — `null` if absent. Lets the seed-idempotency test prove a
   * runtime-registered row was NOT clobbered to `'seed'` by a re-seed.
   */
  readSource(schemaId: string, schemaVersion: number): Promise<'seed' | 'registered' | null>;
  /**
   * Models a new request arriving at the boundary. The sync port surface is
   * preserved (decision O1, refresh-at-request-boundary): a row written
   * out-of-band is observed by the sync lookups only after the boundary
   * refresh runs. The Postgres harness awaits `registry.refresh()`; the idb
   * mirror is a no-op (the in-process store has no async commit-visibility
   * gap). The contract inserts this call BETWEEN every write and the
   * subsequent sync read.
   */
  refreshBoundary(): Promise<void>;
  /**
   * Release factory-acquired resources (e.g. the Postgres pool the node
   * harness opens per case). Without it the node suite leaks connections
   * across cases and exhausts `max_connections`. The idb mirror is a no-op.
   */
  teardown?(): Promise<void>;
}

/**
 * Dynamic-registration + seed-idempotency contract. Runs against BOTH the
 * Postgres (`PostgresControlPlaneRegistry`) and IDB
 * (`InMemoryControlPlaneRegistry`) adapters via their respective harness
 * factories — node↔idb parity.
 *
 * @see specs/domains/runtime/capabilities/control-plane-schema-registry/README.md §"Acceptance"
 */
export function controlPlaneRegistryDynamicContract(
  makeHarness: () => Promise<DynamicRegistryHarness>,
): void {
  // @spec: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#acceptance
  describe('ControlPlaneRegistry dynamic-registration contract', function () {
    let harness: DynamicRegistryHarness;
    beforeEach(async function () {
      harness = await makeHarness();
    });
    afterEach(async function () {
      // Release factory-acquired resources (Postgres pool) between cases so
      // the node suite does not leak connections / exhaust max_connections.
      // The idb mirror's teardown is a no-op.
      await harness.teardown?.();
    });

    // A minimal, ajv-compilable schema doc registered at runtime. Uses a
    // schemaId that the bundled @atlas/schemas set does NOT carry, so the
    // "unregistered → null" precondition holds before the write.
    function hotSchemaDoc(): SchemaRegistryDoc {
      return {
        schemaId: 'runtime.hot_register.v1',
        schemaVersion: 1,
        document: {
          $id: 'runtime.hot_register.v1',
          type: 'object',
          required: ['actionId', 'resourceType', 'note'],
          properties: {
            actionId: { type: 'string' },
            resourceType: { type: 'string' },
            note: { type: 'string' },
          },
          additionalProperties: false,
        },
      };
    }

    function hotAction(): ActionEntry {
      return {
        actionId: 'Runtime.HotRegister.Do',
        resourceType: 'HotResource',
        schemaId: 'runtime.hot_register.v1',
        schemaVersion: 1,
      };
    }

    test('getSchemaValidator returns null for an unregistered (schemaId, version)', function () {
      expect(harness.registry.getSchemaValidator('runtime.hot_register.v1', 1)).toBeNull();
    });

    test('after writing the row, getSchemaValidator returns a compiled validator (hot registration)', async function () {
      const doc = hotSchemaDoc();
      await harness.registerSchema(doc);
      await harness.refreshBoundary();
      const validate = assertDefined(
        harness.registry.getSchemaValidator(doc.schemaId, doc.schemaVersion),
        'a runtime-registered schema MUST be resolvable on the next getSchemaValidator (no restart)',
      );
      // The compiled validator enforces the registered document.
      expect(validate({ actionId: 'Runtime.HotRegister.Do', resourceType: 'HotResource', note: 'ok' })).toBe(true);
      expect(validate({})).toBe(false);
    });

    test('after writing the action row, getAction/hasAction resolve it (hot registration)', async function () {
      const entry = hotAction();
      await harness.registerSchema(hotSchemaDoc());
      await harness.registerAction(entry);
      await harness.refreshBoundary();
      expect(harness.registry.hasAction(entry.actionId)).toBe(true);
      const got = assertDefined(
        harness.registry.getAction(entry.actionId),
        'a runtime-registered action MUST be resolvable on the next getAction',
      );
      expect(got).toEqual(entry);
    });

    test('a runtime-registered (schemaId, version) is unaffected by a later re-seed', async function () {
      const doc = hotSchemaDoc();
      await harness.registerSchema(doc);
      // Re-running the bundled seed MUST NOT overwrite a source='registered' row.
      await harness.reseed();
      await harness.refreshBoundary();
      expect(await harness.readSource(doc.schemaId, doc.schemaVersion)).toBe('registered');
      expect(harness.registry.getSchemaValidator(doc.schemaId, doc.schemaVersion)).not.toBeNull();
    });

    test('cache invalidation: a compiled validator is dropped + recompiled after the (schemaId,version) row changes and the cursor advances', async function () {
      // §"ajv compile-on-demand + cache invalidation": the per-(schemaId,version)
      // compiled-validator cache is event/version-driven (NOT TTL). When the
      // row's document changes and the registry_version cursor advances, the
      // stale compiled validator MUST be dropped and recompiled lazily so the
      // NEW contract is enforced on the next lookup. (Same key, different doc —
      // this is the test seam exercising the invalidation transition, distinct
      // from the static suite's reference-stability check on an UNCHANGED row.)
      const doc = hotSchemaDoc();
      await harness.registerSchema(doc);
      await harness.refreshBoundary();
      const v1 = assertDefined(
        harness.registry.getSchemaValidator(doc.schemaId, doc.schemaVersion),
        'first compile resolves',
      );
      // The original doc forbids additionalProperties beyond the 3 declared.
      expect(v1({ actionId: 'x', resourceType: 'y', note: 'z', extra: 1 })).toBe(false);

      // Rewrite the SAME (schemaId, version) row with a laxer document and
      // advance the cursor. (registerSchema bumps the version cursor.)
      await harness.registerSchema({
        ...doc,
        document: { ...doc.document, additionalProperties: true },
      });
      await harness.refreshBoundary();
      const v2 = assertDefined(
        harness.registry.getSchemaValidator(doc.schemaId, doc.schemaVersion),
        'after the row change + cursor advance, a recompiled validator MUST resolve',
      );
      // The recompiled validator MUST enforce the NEW (laxer) document — proof
      // the stale compiled validator was dropped, not served from cache.
      expect(
        v2({ actionId: 'x', resourceType: 'y', note: 'z', extra: 1 }),
        'a stale compiled validator MUST be dropped + recompiled after the row changes (version-driven invalidation, not TTL)',
      ).toBe(true);
    });

    test('versioning rule: registering a DIFFERENT document under a NEW version coexists; the original version is unchanged', async function () {
      // §"Hot-registration contract": re-registering an identical
      // (schemaId, version) is idempotent; a DIFFERENT document belongs under
      // a BUMPED schema_version (no in-place mutation of a live id+version).
      // Both versions resolve independently and enforce their own contract.
      const v1Doc: SchemaRegistryDoc = {
        schemaId: 'runtime.versioned.vN',
        schemaVersion: 1,
        document: {
          $id: 'runtime.versioned.vN',
          type: 'object',
          required: ['a'],
          properties: { a: { type: 'string' } },
          additionalProperties: false,
        },
      };
      const v2Doc: SchemaRegistryDoc = {
        schemaId: 'runtime.versioned.vN',
        schemaVersion: 2,
        document: {
          $id: 'runtime.versioned.vN',
          type: 'object',
          required: ['b'],
          properties: { b: { type: 'number' } },
          additionalProperties: false,
        },
      };
      await harness.registerSchema(v1Doc);
      await harness.registerSchema(v2Doc);
      await harness.refreshBoundary();

      const validateV1 = assertDefined(
        harness.registry.getSchemaValidator('runtime.versioned.vN', 1),
        'version 1 stays resolvable after a new version is registered',
      );
      const validateV2 = assertDefined(
        harness.registry.getSchemaValidator('runtime.versioned.vN', 2),
        'the bumped version is independently resolvable',
      );
      // v1 enforces {a:string}; v2 enforces {b:number} — no cross-contamination.
      expect(validateV1({ a: 'ok' })).toBe(true);
      expect(validateV1({ b: 1 })).toBe(false);
      expect(validateV2({ b: 1 })).toBe(true);
      expect(validateV2({ a: 'ok' })).toBe(false);
    });

    test('re-registering an IDENTICAL (schemaId, version) is idempotent — no error, still resolvable', async function () {
      // §"Hot-registration contract": "Re-registering an identical
      // (schemaId, version) is idempotent (upsert or no-op)."
      const doc = hotSchemaDoc();
      await harness.registerSchema(doc);
      await harness.registerSchema(doc); // identical re-register — MUST NOT throw
      await harness.refreshBoundary();
      expect(harness.registry.getSchemaValidator(doc.schemaId, doc.schemaVersion)).not.toBeNull();
      expect(await harness.readSource(doc.schemaId, doc.schemaVersion)).toBe('registered');
    });

    test('UNKNOWN_ACTION negative: getAction/hasAction stay false+null for a still-unregistered action', function () {
      // §"Things That DON'T Change": observable behavior for a not-yet-registered
      // action is unchanged — getAction returns null (callers map to
      // UNKNOWN_ACTION), and the lookup does NOT throw.
      expect(harness.registry.hasAction('Runtime.NeverRegistered.Do')).toBe(false);
      expect(harness.registry.getAction('Runtime.NeverRegistered.Do')).toBeNull();
    });

    test('seed idempotency: a bundled schema is present after the first seed and re-seed is a no-op', async function () {
      // The bundle seeds catalog.seed_package.apply.v1 with source='seed'.
      await harness.reseed();
      expect(await harness.readSource('catalog.seed_package.apply.v1', 1)).toBe('seed');
      // Re-seeding does not flip the source nor duplicate the row.
      await harness.reseed();
      expect(await harness.readSource('catalog.seed_package.apply.v1', 1)).toBe('seed');
    });
  });
}

export function controlPlaneRegistryContract(
  makeRegistry: () => Promise<ControlPlaneRegistry>,
): void {
  describe('ControlPlaneRegistry contract', function () {
    let registry: ControlPlaneRegistry;
    beforeEach(async function () {
      registry = await makeRegistry();
    });
    test('hasAction returns true for the bundled Catalog.SeedPackage.Apply action', function () {
      expect(registry.hasAction('Catalog.SeedPackage.Apply')).toBe(true);
    });
    test('hasAction returns true for the bundled Catalog.Family.Publish action', function () {
      expect(registry.hasAction('Catalog.Family.Publish')).toBe(true);
    });
    test('hasAction returns false for an unknown action', function () {
      expect(registry.hasAction('Made.Up.Action')).toBe(false);
    });
    test('getAction returns a populated entry for a known action', function () {
      const entry = assertDefined(
        registry.getAction('Catalog.SeedPackage.Apply'),
        'getAction should return an entry for the bundled Catalog.SeedPackage.Apply action',
      );
      expect(entry.actionId).toBe('Catalog.SeedPackage.Apply');
      expect(entry.resourceType).toBe('SeedPackage');
      expect(entry.schemaId).toBe('catalog.seed_package.apply.v1');
      expect(entry.schemaVersion).toBe(1);
    });
    test('getAction returns null for an unknown action', function () {
      expect(registry.getAction('Nope.None')).toBeNull();
    });
    test('getSchemaValidator returns a working validator that accepts conforming payloads and rejects empty objects', function () {
      // Schema `catalog.seed_package.apply.v1` (see
      // `packages/schemas/src/generated/...`) requires:
      //   actionId, resourceType, seedPackageKey, seedPackageVersion, payload
      // and uses additionalProperties: false. The validator must accept a
      // structurally valid payload and reject one missing the required fields.
      const validate = assertDefined(
        registry.getSchemaValidator('catalog.seed_package.apply.v1', 1),
        'getSchemaValidator should return a compiled validator for catalog.seed_package.apply.v1',
      );
      const valid = {
        actionId: 'Catalog.SeedPackage.Apply',
        resourceType: 'SeedPackage',
        seedPackageKey: 'badge-family',
        seedPackageVersion: '1.0.0',
        payload: { kind: 'badge_family' },
      };
      expect(validate(valid)).toBe(true);
      // Empty object lacks all required fields.
      expect(validate({})).toBe(false);
    });
    test('[error-shape] getSchemaValidator returns null for an unknown schema id (does not throw)', function () {
      // Contract: unknown schemaId is NOT an exception. Callers (the ingress
      // submitIntent pipeline) check the null and return a typed
      // UNKNOWN_SCHEMA error themselves; the registry stays a pure lookup.
      const validate = registry.getSchemaValidator('does.not.exist.v1', 1);
      expect(validate).toBeNull();
    });
    test('getSchemaValidator is stable — repeated calls return the same validator instance', function () {
      const v1 = registry.getSchemaValidator('catalog.seed_package.apply.v1', 1);
      const v2 = registry.getSchemaValidator('catalog.seed_package.apply.v1', 1);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
      // Reference equality is the strongest signal of caching; both adapters
      // return the same compiled function from the ajv registry.
      expect(v1).toBe(v2);
    });
    test('getAction is read-only: repeated reads do not mutate state', function () {
      const e1 = registry.getAction('Catalog.SeedPackage.Apply');
      const e2 = registry.getAction('Catalog.SeedPackage.Apply');
      expect(e1).toEqual(e2);
    });
  });
}
