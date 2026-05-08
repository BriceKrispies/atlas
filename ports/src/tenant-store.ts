/**
 * TenantStore — control-plane registry of provisioned tenants.
 *
 * Read path is `PostgresTenantDbProvider` (it consults
 * `control_plane.tenants` to resolve a tenantId to a connection); the
 * write path lived in scripts only until the tenancy module needed it.
 * Now exposed as a port so module code never reaches into adapter SQL.
 *
 * Schema lives in `control_plane.tenants` (created by
 * `00000001_initial.sql`). The status column accepts `'active' |
 * 'pending' | 'disabled'`.
 */
export type TenantStatus = 'active' | 'pending' | 'disabled';

export interface TenantRecord {
  tenantId: string;
  name: string;
  status: TenantStatus;
  region: string | null;
  createdAt: string;
}

export interface CreateTenantInput {
  tenantId: string;
  name: string;
  status?: TenantStatus;
  region?: string;
}

export interface TenantStore {
  /**
   * Insert a new tenant row. Throws on conflict (the caller owns
   * idempotency checks via `get` first) so silent overwrites can't
   * happen.
   */
  create(input: CreateTenantInput): Promise<TenantRecord>;

  get(tenantId: string): Promise<TenantRecord | null>;
}
