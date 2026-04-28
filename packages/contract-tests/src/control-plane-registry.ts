import { describe, test, expect, beforeEach } from 'vitest';
import type { ControlPlaneRegistry } from '@atlas/ports';

export function controlPlaneRegistryContract(
  makeRegistry: () => Promise<ControlPlaneRegistry>,
): void {
  describe('ControlPlaneRegistry contract', () => {
    let registry: ControlPlaneRegistry;
    beforeEach(async () => {
      registry = await makeRegistry();
    });

    test('hasAction returns true for the bundled Catalog.SeedPackage.Apply action', () => {
      expect(registry.hasAction('Catalog.SeedPackage.Apply')).toBe(true);
    });

    test('hasAction returns true for the bundled Catalog.Family.Publish action', () => {
      expect(registry.hasAction('Catalog.Family.Publish')).toBe(true);
    });

    test('hasAction returns false for an unknown action', () => {
      expect(registry.hasAction('Made.Up.Action')).toBe(false);
    });

    test('getAction returns a populated entry for a known action', () => {
      const entry = registry.getAction('Catalog.SeedPackage.Apply');
      expect(entry).not.toBeNull();
      expect(entry!.actionId).toBe('Catalog.SeedPackage.Apply');
      expect(entry!.resourceType).toBe('SeedPackage');
      expect(entry!.schemaId).toBe('catalog.seed_package.apply.v1');
      expect(entry!.schemaVersion).toBe(1);
    });

    test('getAction returns null for an unknown action', () => {
      expect(registry.getAction('Nope.None')).toBeNull();
    });

    test('getSchemaValidator returns a working validator that accepts conforming payloads and rejects empty objects', () => {
      // Schema `catalog.seed_package.apply.v1` (see
      // `packages/schemas/src/generated/...`) requires:
      //   actionId, resourceType, seedPackageKey, seedPackageVersion, payload
      // and uses additionalProperties: false. The validator must accept a
      // structurally valid payload and reject one missing the required fields.
      const validate = registry.getSchemaValidator('catalog.seed_package.apply.v1', 1);
      expect(validate).not.toBeNull();

      const valid = {
        actionId: 'Catalog.SeedPackage.Apply',
        resourceType: 'SeedPackage',
        seedPackageKey: 'badge-family',
        seedPackageVersion: '1.0.0',
        payload: { kind: 'badge_family' },
      };
      expect(validate!(valid)).toBe(true);

      // Empty object lacks all required fields.
      expect(validate!({})).toBe(false);
    });

    test('[error-shape] getSchemaValidator returns null for an unknown schema id (does not throw)', () => {
      // Contract: unknown schemaId is NOT an exception. Callers (the ingress
      // submitIntent pipeline) check the null and return a typed
      // UNKNOWN_SCHEMA error themselves; the registry stays a pure lookup.
      const validate = registry.getSchemaValidator('does.not.exist.v1', 1);
      expect(validate).toBeNull();
    });

    test('getSchemaValidator is stable — repeated calls return the same validator instance', () => {
      const v1 = registry.getSchemaValidator('catalog.seed_package.apply.v1', 1);
      const v2 = registry.getSchemaValidator('catalog.seed_package.apply.v1', 1);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
      // Reference equality is the strongest signal of caching; both adapters
      // return the same compiled function from the ajv registry.
      expect(v1).toBe(v2);
    });

    test('getAction is read-only: repeated reads do not mutate state', () => {
      const e1 = registry.getAction('Catalog.SeedPackage.Apply');
      const e2 = registry.getAction('Catalog.SeedPackage.Apply');
      expect(e1).toEqual(e2);
    });
  });
}
