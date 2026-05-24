/**
 * Cross-adapter contract for `ClusterStore`.
 *
 * The Postgres adapter (`@atlas/adapter-node`) runs the full round-trip via
 * `clusterStoreContract`. The IDB adapter (`@atlas/adapter-idb`) is a
 * throwing stub — clusters are platform-side only, with no browser/sim use
 * case — so it runs `clusterStorePlatformOnlyContract`, which asserts every
 * method throws the documented "platform-side only" error. This keeps the
 * parity wiring honest: both adapters import a contract from this package.
 *
 * See
 * `specs/domains/compute/cluster/capabilities/cluster-registration/README.md`.
 */
import { describe, test, expect, beforeEach } from '@atlas/test';
import type { ClusterStore } from '@atlas/ports';
import { assertDefined } from '@atlas/test-fixtures/assert';

export interface ClusterStoreFactoryResult {
  store: ClusterStore;
  dispose?: () => Promise<void> | void;
}

export interface ClusterStoreFactoryOptions {
  factory: () => Promise<ClusterStoreFactoryResult>;
}

/**
 * Full behavioural contract. The factory must hand back a fresh, empty
 * `ClusterStore` on each call (the suite registers no global cleanup beyond
 * `dispose`).
 */
export function clusterStoreContract(opts: ClusterStoreFactoryOptions): void {
  describe('ClusterStore contract', function () {
    let store: ClusterStore;
    let dispose: (() => Promise<void> | void) | undefined;

    beforeEach(async function () {
      const result = await opts.factory();
      store = result.store;
      dispose = result.dispose;
    });

    test('get returns null for an unknown cluster', async function () {
      expect(await store.get('nope')).toBeNull();
      await dispose?.();
    });

    test('round-trip: add → get → list → disable → list(activeOnly)', async function () {
      await store.add({
        clusterId: 'dev',
        name: 'Dev Cluster',
        endpoint: 'https://k3s.example.test:6443',
        authKind: 'kubeconfig',
        authSecret: 'apiVersion: v1\nkind: Config\n',
        region: 'fsn1',
      });

      const got = assertDefined(await store.get('dev'), 'dev was just added');
      expect(got.clusterId).toBe('dev');
      expect(got.name).toBe('Dev Cluster');
      expect(got.endpoint).toBe('https://k3s.example.test:6443');
      expect(got.authKind).toBe('kubeconfig');
      expect(got.authSecret).toBe('apiVersion: v1\nkind: Config\n');
      expect(got.region).toBe('fsn1');
      expect(got.status).toBe('active');
      expect(typeof got.createdAt).toBe('string');

      const all = await store.list();
      expect(all).toHaveLength(1);
      expect(assertDefined(all[0], 'list has 1 row').clusterId).toBe('dev');

      await store.disable('dev');
      const afterDisable = assertDefined(await store.get('dev'), 'row stays for audit');
      expect(afterDisable.status).toBe('disabled');

      // list() with no filter still surfaces the disabled row.
      expect(await store.list()).toHaveLength(1);
      // list(activeOnly:true) hides it.
      expect(await store.list({ activeOnly: true })).toHaveLength(0);

      await dispose?.();
    });

    test('add with token auth and no region', async function () {
      await store.add({
        clusterId: 'prod',
        name: 'Prod',
        endpoint: 'https://prod.example.test:6443',
        authKind: 'token',
        authSecret: 'sa-token-xyz',
      });
      const got = assertDefined(await store.get('prod'), 'prod was just added');
      expect(got.authKind).toBe('token');
      expect(got.authSecret).toBe('sa-token-xyz');
      expect(got.region).toBeNull();
      await dispose?.();
    });

    test('add is idempotent — re-registering an existing id is a no-op (I3)', async function () {
      await store.add({
        clusterId: 'dev',
        name: 'Original',
        endpoint: 'https://one.example.test:6443',
        authKind: 'token',
        authSecret: 'first',
      });
      // Re-register with different fields — must not overwrite or throw.
      await store.add({
        clusterId: 'dev',
        name: 'Changed',
        endpoint: 'https://two.example.test:6443',
        authKind: 'kubeconfig',
        authSecret: 'second',
      });
      const got = assertDefined(await store.get('dev'), 'dev still present');
      expect(got.name).toBe('Original');
      expect(got.endpoint).toBe('https://one.example.test:6443');
      expect(got.authSecret).toBe('first');
      expect(await store.list()).toHaveLength(1);
      await dispose?.();
    });

    test('disable is idempotent — disabling twice or an unknown id is a no-op (I3)', async function () {
      await store.add({
        clusterId: 'dev',
        name: 'Dev',
        endpoint: 'https://dev.example.test:6443',
        authKind: 'token',
        authSecret: 't',
      });
      await store.disable('dev');
      await store.disable('dev'); // second time: no-op, no throw
      await store.disable('never-existed'); // unknown id: no-op, no throw
      const got = assertDefined(await store.get('dev'), 'dev present');
      expect(got.status).toBe('disabled');
      await dispose?.();
    });

    test('list orders by createdAt ascending', async function () {
      await store.add({
        clusterId: 'a',
        name: 'A',
        endpoint: 'https://a.example.test:6443',
        authKind: 'token',
        authSecret: 't',
      });
      await store.add({
        clusterId: 'b',
        name: 'B',
        endpoint: 'https://b.example.test:6443',
        authKind: 'token',
        authSecret: 't',
      });
      const all = await store.list();
      expect(all.map((r) => r.clusterId)).toEqual(['a', 'b']);
      await dispose?.();
    });
  });
}

/**
 * Negative contract for the IDB stub. Every `ClusterStore` method must
 * reject with an error mentioning "platform-side only" — clusters are a
 * server-only concern. Mirrors the established server-only-stub pattern
 * (`IdbRepositoryStore`).
 */
export function clusterStorePlatformOnlyContract(
  makeStore: () => ClusterStore,
): void {
  describe('ClusterStore platform-side-only stub contract', function () {
    let store: ClusterStore;
    beforeEach(function () {
      store = makeStore();
    });

    test('add rejects', async function () {
      await expect(
        store.add({
          clusterId: 'x',
          name: 'X',
          endpoint: 'https://x.test:6443',
          authKind: 'token',
          authSecret: 't',
        }),
      ).rejects.toThrow(/platform-side only/i);
    });

    test('get rejects', async function () {
      await expect(store.get('x')).rejects.toThrow(/platform-side only/i);
    });

    test('list rejects', async function () {
      await expect(store.list()).rejects.toThrow(/platform-side only/i);
    });

    test('disable rejects', async function () {
      await expect(store.disable('x')).rejects.toThrow(/platform-side only/i);
    });
  });
}
