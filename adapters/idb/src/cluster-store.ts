/**
 * IdbClusterStore — platform-side-only stub.
 *
 * Clusters are a server/control-plane concern; there is no browser/sim use
 * case for registering or reading deployment clusters. Every method rejects
 * with a "platform-side only" error. The stub exists solely so contract-test
 * parity wiring holds (both adapters import a `ClusterStore` contract). Mirrors
 * the `IdbRepositoryStore` server-only-stub pattern.
 *
 * See `specs/domains/compute/cluster/capabilities/cluster-registration/README.md`.
 */
import type {
  ClusterAddInput,
  ClusterRecord,
  ClusterStore,
} from '@atlas/ports';

const MESSAGE = 'ClusterStore is platform-side only';

export class IdbClusterStore implements ClusterStore {
  add(_input: ClusterAddInput): Promise<void> {
    return Promise.reject(new Error(MESSAGE));
  }
  get(_clusterId: string): Promise<ClusterRecord | null> {
    return Promise.reject(new Error(MESSAGE));
  }
  list(_opts?: { activeOnly?: boolean }): Promise<ReadonlyArray<ClusterRecord>> {
    return Promise.reject(new Error(MESSAGE));
  }
  disable(_clusterId: string): Promise<void> {
    return Promise.reject(new Error(MESSAGE));
  }
}
