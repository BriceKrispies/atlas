/**
 * Port: PolicyStore — read/write the tenant's Cedar policy bundles.
 *
 * Promoted from `@atlas/authz` to the port layer per ADR 0016: it is a
 * storage interface implemented by an adapter (`PostgresPolicyStore` in
 * `@atlas/adapter-node`), so it belongs in Ring 1, not in a Ring 3 domain
 * module. The adapter previously reached back into `@atlas/authz` for both
 * this interface and its error type — a sibling-ring edge. Both now live here.
 *
 * Backed by the `control_plane.policies` table:
 *   `(tenant_id, version, policy_json jsonb, status, created_at)`
 *
 * `policy_json` is the wrapper:
 *   `{ format: "cedar-text", policies: "...", schemaVersion: 1 }`
 *
 * Activation is atomic at the DB layer: a partial unique index
 * (`WHERE status = 'active'`) on `(tenant_id)` enforces exactly one active
 * row per tenant.
 */

export type PolicyStatus = 'draft' | 'active' | 'archived';

export interface PolicySummary {
  tenantId: string;
  version: number;
  status: PolicyStatus;
  description: string | null;
  lastModifiedAt: string;
  lastModifiedBy: string | null;
}

export interface PolicyDetail extends PolicySummary {
  cedarText: string;
}

export interface PolicyStore {
  list(tenantId: string): Promise<readonly PolicySummary[]>;
  get(tenantId: string, version: number): Promise<PolicyDetail | null>;
  /**
   * Insert a new draft. Version is monotonically assigned by the store
   * (max(version) + 1 — the unique index on the table will catch any race).
   * Returns the newly minted version.
   */
  createDraft(input: {
    tenantId: string;
    cedarText: string;
    description: string | null;
    principalId: string | null;
  }): Promise<number>;
  /**
   * Promote a draft to active and demote any prior active in one
   * transaction. Throws `PolicyStoreError` if the target version is not in
   * `draft` status, or if the target version doesn't exist.
   */
  activate(input: { tenantId: string; version: number; principalId: string | null }): Promise<void>;
  /**
   * Flip status to `archived`. Throws `PolicyStoreError` if the target row is
   * the sole `active` row for the tenant — archiving it would leave the tenant
   * policy-less.
   */
  archive(input: { tenantId: string; version: number; principalId: string | null }): Promise<void>;
}

/**
 * Error contract for the PolicyStore port. The codes are part of the port's
 * contract (the `activate`/`archive`/`get` docs say "Throws if …"). Shape
 * (`code: string`, `status: number`) matches the platform error envelope, so
 * the ingress error-translation layer maps it by `code`/`status` exactly as it
 * did the domain's `AuthzError` (translation is structural, not `instanceof`).
 */
export const policyStoreErrorCodes = {
  POLICY_NOT_FOUND: 'POLICY_NOT_FOUND',
  POLICY_NOT_DRAFT: 'POLICY_NOT_DRAFT',
  POLICY_LAST_ACTIVE: 'POLICY_LAST_ACTIVE',
} as const;

export type PolicyStoreErrorCode =
  (typeof policyStoreErrorCodes)[keyof typeof policyStoreErrorCodes];

export class PolicyStoreError extends Error {
  public readonly code: string;
  public readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'PolicyStoreError';
  }
}
