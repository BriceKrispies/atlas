/**
 * Port: PolicyStore — read/write the tenant's Cedar policy bundles.
 *
 * Backed by the `control_plane.policies` table:
 *   `(tenant_id, version, policy_json jsonb, status, created_at)`
 *
 * `policy_json` is the wrapper:
 *   `{ format: "cedar-text", policies: "...", schemaVersion: 1 }`
 *
 * Activation is atomic at the DB layer: a partial unique index
 * (`WHERE status = 'active'`) on `(tenant_id)` enforces exactly one active
 * row per tenant — the activate handler issues a single UPDATE that demotes
 * the prior active and promotes the target version inside one transaction.
 *
 * Archive is application-layer guarded: the handler refuses if archiving
 * would leave the tenant policy-less (i.e. the row is the sole active).
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
   * transaction. Throws if the target version is not in `draft` status,
   * or if the target version doesn't exist.
   */
  activate(input: { tenantId: string; version: number; principalId: string | null }): Promise<void>;
  /**
   * Flip status to `archived`. Throws if the target row is the sole
   * `active` row for the tenant — archiving it would leave the tenant
   * policy-less. The fallback (allow-all-with-tenant-scope) is the
   * documented behaviour for tenants with no active bundle, but explicit
   * archive of the last bundle is treated as a safety violation that the
   * caller should handle (typically by activating a replacement first).
   */
  archive(input: { tenantId: string; version: number; principalId: string | null }): Promise<void>;
}
