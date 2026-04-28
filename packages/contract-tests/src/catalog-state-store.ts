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

    test('[error-shape] put with an empty tenantId is accepted at the port layer (callers must enforce non-empty)', async () => {
      // The port itself does not validate tenantId — it's a flat KV. Tenant
      // non-emptiness is enforced upstream by the ingress submit pipeline
      // (Invariant I7); pushing it down to every adapter would duplicate
      // that check and create divergence risk between IDB and Postgres.
      // Contract: empty tenantId is a normal write. We pin both adapters
      // to the same forgiving behaviour so the parity tests stay aligned.
      const r = rec({ tenantId: '', seedPackageVersion: 'v-empty' });
      await expect(store.put(r)).resolves.toBeUndefined();
      const got = await store.get('');
      expect(got).not.toBeNull();
      expect(got!.seedPackageVersion).toBe('v-empty');
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

    test('[concurrency] concurrent overwrites of the same tenant land one of the racing values intact', async () => {
      // Fire 10 concurrent puts at the SAME tenant key with distinct,
      // internally-correlated payloads. Last-writer-wins is fine, but the
      // final stored record MUST be one of the 10 attempted records in full
      // — no torn writes, no half-merged blob.
      const tenantId = 'tenant-overwrite-race';
      const candidates = Array.from({ length: 10 }, (_, i) =>
        rec({
          tenantId,
          seedPackageVersion: `v${i}`,
          publishedRevisions: { 'fam-x': i },
          payload: { kind: 'badge_family', marker: i },
        }),
      );
      await Promise.all(candidates.map((c) => store.put(c)));

      const got = await store.get(tenantId);
      expect(got).not.toBeNull();

      // The final record must match exactly one of the candidates — version,
      // payload, and publishedRevisions all from the same source.
      const winner = candidates.find(
        (c) => c.seedPackageVersion === got!.seedPackageVersion,
      );
      expect(winner).toBeDefined();
      expect(got!.payload).toEqual(winner!.payload);
      expect(got!.publishedRevisions).toEqual(winner!.publishedRevisions);
    });
  });
}
