/**
 * ClusterStore — the seam where Atlas records the Kubernetes clusters it
 * can deploy workloads to. Platform-level (NOT tenant-scoped): cluster
 * records live in `control_plane.clusters` and apply across the whole
 * deployment, so no method takes a `tenantId`. Tenant→cluster bindings are
 * a separate capability where tenant isolation (I7) applies.
 *
 * Implemented by `@atlas/adapter-node` (Postgres). The `@atlas/adapter-idb`
 * counterpart is a throwing stub — clusters are platform-side only and have
 * no browser/sim use case; the stub exists solely so contract-test parity
 * wiring holds. See
 * `specs/domains/compute/cluster/capabilities/cluster-registration/README.md`.
 *
 * Register/disable are idempotent at the operator-script level (I3):
 * re-registering an existing cluster is a no-op; disabling an already
 * disabled cluster is a no-op.
 */

/** How Atlas authenticates to a cluster's Kubernetes API. */
export type ClusterAuthKind = 'kubeconfig' | 'token';

/** Lifecycle status of a registered cluster. */
export type ClusterStatus = 'active' | 'disabled';

export interface ClusterAddInput {
  /** kebab-case identifier, e.g. `dev`, `prod-us-fsn`. */
  clusterId: string;
  /** Human-readable display name. */
  name: string;
  /** Kubernetes API URL, e.g. `https://k3s.example.com:6443`. */
  endpoint: string;
  authKind: ClusterAuthKind;
  /**
   * The credential payload — full kubeconfig contents (`authKind`
   * `kubeconfig`) or a ServiceAccount token (`authKind` `token`). Stored
   * as TEXT in Phase 0; at-rest encryption is a future capability.
   */
  authSecret: string;
  /** Optional region tag, e.g. `fsn1`. */
  region?: string;
}

export interface ClusterRecord {
  clusterId: string;
  name: string;
  endpoint: string;
  authKind: ClusterAuthKind;
  authSecret: string;
  /** null when no region was supplied at registration. */
  region: string | null;
  status: ClusterStatus;
  /** RFC-3339 timestamp string. */
  createdAt: string;
}

export interface ClusterStore {
  /**
   * Register a cluster. Idempotent: registering a `clusterId` that already
   * exists is a no-op (the existing row is left untouched) (I3).
   */
  add(input: ClusterAddInput): Promise<void>;

  /**
   * Look up a cluster by id (any status). Returns null when no row exists.
   */
  get(clusterId: string): Promise<ClusterRecord | null>;

  /**
   * List registered clusters. With `activeOnly: true`, only `active`
   * clusters are returned. Ordered by `created_at` ascending.
   */
  list(opts?: { activeOnly?: boolean }): Promise<ReadonlyArray<ClusterRecord>>;

  /**
   * Flip a cluster to `disabled`. Idempotent: disabling an already
   * disabled (or unknown) cluster is a no-op (I3). The row stays in place
   * for audit; subsequent deploys fail-fast against a disabled cluster.
   */
  disable(clusterId: string): Promise<void>;
}
