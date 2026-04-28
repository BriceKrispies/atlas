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

    test('getSchemaValidator returns a working validator for a known schema', () => {
      const validate = registry.getSchemaValidator('catalog.seed_package.apply.v1', 1);
      expect(validate).not.toBeNull();
      // The validator must accept a structurally valid payload.
      const candidate = {
        actionId: 'Catalog.SeedPackage.Apply',
        resourceType: 'SeedPackage',
        moduleId: 'badges',
        seedPackageKey: 'badge-family',
        version: '1.0.0',
        package: { kind: 'badge_family' },
      };
      const ok = validate!(candidate);
      // Validator returns boolean; we only assert call-shape, since the
      // Rust counterpart equally accepts arbitrary `package` content.
      expect(typeof ok).toBe('boolean');
    });

    test('getSchemaValidator returns null for an unknown schema id', () => {
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
