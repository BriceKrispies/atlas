/**
 * IdbClusterStore — runs the negative `ClusterStore` contract from
 * `@atlas/contract-tests`. Clusters are platform-side only; the IDB stub
 * throws on every method. This run keeps the parity wiring honest: both
 * adapters import a ClusterStore contract from the shared package.
 *
 * See
 * `specs/domains/compute/cluster/capabilities/cluster-registration/README.md`.
 */
import { clusterStorePlatformOnlyContract } from '@atlas/contract-tests';
import { IdbClusterStore } from '@atlas/adapter-idb';

clusterStorePlatformOnlyContract(function () {
  return new IdbClusterStore();
});
