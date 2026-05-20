/**
 * PostgresTenantStore — write surface for `control_plane.tenants`.
 *
 * The reading side already lives in `PostgresTenantDbProvider` (it
 * resolves a tenantId to a connection); this is the inserter the
 * tenancy module reaches for during signup approval. Per-tenant DB
 * connection info (`db_host`, `db_port`, …) is populated separately
 * by `PostgresTenantDbProvider.provisionTenantDatabase` — ADR 0005
 * commits to db-per-tenant and the fallback is gone (phase 3, 2026-05-20).
 * Callers MUST run the provisioner after inserting the tenant row,
 * otherwise the first `getPool(tenantId)` throws
 * `TENANT_DATABASE_NOT_PROVISIONED`.
 */

import type postgres from 'postgres';
import type {
  CreateTenantInput,
  TenantRecord,
  TenantStatus,
  TenantStore,
} from '@atlas/ports';

interface TenantRow {
  tenant_id: string;
  name: string;
  status: TenantStatus;
  region: string | null;
  created_at: string;
}

function rowToTenant(row: TenantRow): TenantRecord {
  return {
    tenantId: row.tenant_id,
    name: row.name,
    status: row.status,
    region: row.region,
    createdAt: row.created_at,
  };
}

export class PostgresTenantStore implements TenantStore {
  constructor(private readonly sql: postgres.Sql) {}

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    const status: TenantStatus = input.status ?? 'active';
    const rows = await this.sql<TenantRow[]>`
      INSERT INTO control_plane.tenants (
        tenant_id, name, status, region
      ) VALUES (
        ${input.tenantId},
        ${input.name},
        ${status},
        ${input.region ?? null}
      )
      RETURNING tenant_id, name, status, region, created_at
    `;
    const r = rows[0];
    if (!r) throw new Error('tenants insert returned no row');
    return rowToTenant(r);
  }

  async get(tenantId: string): Promise<TenantRecord | null> {
    const rows = await this.sql<TenantRow[]>`
      SELECT tenant_id, name, status, region, created_at
      FROM control_plane.tenants
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `;
    const r = rows[0];
    return r ? rowToTenant(r) : null;
  }
}
