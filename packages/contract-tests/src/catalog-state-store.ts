import { describe, test, expect, beforeEach } from 'vitest';
import type { CatalogStateRecord, CatalogStateStore } from '@atlas/ports';

function rec(overrides: Partial<CatalogStateRecord> = {}): CatalogStateRecord {
  return {
    tenantId: overrides.tenantId ?? 'tenant-a',
    seedPackageKey: overrides.seedPackageKey ?? 'badge-family',
    seedPackageVersion: overrides.seedPackageVersion ?? '1.0.0',
    payload: overrides.payload ?? { kind: 'badge_family', families: [] },
    publishedRevisions: overrides.publishedRevisions ?? {},
  };
}

export function catalogStateStoreContract(
  makeStore: () => Promise<CatalogStateStore>,
): void {
  describe('CatalogStateStore contract', () => {
    let store: CatalogStateStore;
    beforeEach(async () => {
      store = await makeStore();
    });

    test('get returns null for an unseen tenant', async () => {
      const got = await store.get('never-seen');
      expect(got).toBeNull();
    });

    test('put + get round-trips a record', async () => {
      const r = rec({ tenantId: 'tenant-rt' });
      await store.put(r);
      const got = await store.get('tenant-rt');
      expect(got).toEqual(r);
    });

    test('put overwrites an existing tenant record', async () => {
      await store.put(rec({ tenantId: 'tenant-ow', seedPackageVersion: '1.0.0' }));
      await store.put(rec({ tenantId: 'tenant-ow', seedPackageVersion: '1.0.1' }));
      const got = await store.get('tenant-ow');
      expect(got!.seedPackageVersion).toBe('1.0.1');
    });

    test('tenant isolation: storing under one tenant does not leak to another', async () => {
      await store.put(rec({ tenantId: 'tenant-iso-a', seedPackageVersion: '9.9.9' }));
      const a = await store.get('tenant-iso-a');
      const b = await store.get('tenant-iso-b');
      expect(a).not.toBeNull();
      expect(a!.seedPackageVersion).toBe('9.9.9');
      expect(b).toBeNull();
    });

    test('publishedRevisions map round-trips intact', async () => {
      const revisions = { 'fam-1': 3, 'fam-2': 7 };
      await store.put(rec({ tenantId: 'tenant-rev', publishedRevisions: revisions }));
      const got = await store.get('tenant-rev');
      expect(got!.publishedRevisions).toEqual(revisions);
    });

    test('payload preserves nested object shape', async () => {
      const payload = {
        kind: 'badge_family',
        families: [
          { familyId: 'svc-anniv', revisions: [1, 2, 3] },
          { familyId: 'milestone', revisions: [1] },
        ],
      };
      await store.put(rec({ tenantId: 'tenant-payload', payload }));
      const got = await store.get('tenant-payload');
      expect(got!.payload).toEqual(payload);
    });

    test('[concurrency] concurrent puts under different tenants do not interfere', async () => {
      const puts: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        puts.push(
          store.put(rec({ tenantId: `tenant-cc-${i}`, seedPackageVersion: `v${i}` })),
        );
      }
      await Promise.all(puts);
      for (let i = 0; i < 10; i++) {
        const got = await store.get(`tenant-cc-${i}`);
        expect(got).not.toBeNull();
        expect(got!.seedPackageVersion).toBe(`v${i}`);
      }
    });
  });
}
