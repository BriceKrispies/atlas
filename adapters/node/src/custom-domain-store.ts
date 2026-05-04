/**
 * PostgresCustomDomainStore — Postgres-backed `CustomDomainStore`.
 *
 * Schema is installed by
 * `migrations/control-plane/20260503000001_custom_domains.sql` (run via
 * the @atlas/adapter-node migration runner). Stub-mode shape only — see
 * the migration header and
 * `specs/domains/tenancy/capabilities/custom-domains/README.md` for the
 * upgrade plan.
 *
 * Hostnames are stored exactly as given. Callers MUST normalize before
 * calling (`normalizeHost` in `@atlas/platform-core/tenant-urls`).
 */

import type { CustomDomain, CustomDomainStore } from '@atlas/ports';
import type postgres from 'postgres';

interface CustomDomainRow {
  hostname: string;
  tenant_id: string;
  status: string;
  is_primary: boolean;
  created_at: string;
}

function rowToDomain(row: CustomDomainRow): CustomDomain {
  return {
    hostname: row.hostname,
    tenantId: row.tenant_id,
    status: row.status,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

export class PostgresCustomDomainStore implements CustomDomainStore {
  constructor(private readonly sql: postgres.Sql) {}

  async getByHostname(hostname: string): Promise<CustomDomain | null> {
    const rows = await this.sql<CustomDomainRow[]>`
      SELECT hostname, tenant_id, status, is_primary, created_at
      FROM control_plane.custom_domains
      WHERE hostname = ${hostname}
        AND status = 'active'
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToDomain(row) : null;
  }

  async getPrimary(tenantId: string): Promise<CustomDomain | null> {
    const rows = await this.sql<CustomDomainRow[]>`
      SELECT hostname, tenant_id, status, is_primary, created_at
      FROM control_plane.custom_domains
      WHERE tenant_id = ${tenantId}
        AND status = 'active'
        AND is_primary = TRUE
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToDomain(row) : null;
  }

  async list(tenantId: string): Promise<CustomDomain[]> {
    const rows = await this.sql<CustomDomainRow[]>`
      SELECT hostname, tenant_id, status, is_primary, created_at
      FROM control_plane.custom_domains
      WHERE tenant_id = ${tenantId}
      ORDER BY is_primary DESC, created_at ASC
    `;
    return rows.map(rowToDomain);
  }

  async add(input: {
    hostname: string;
    tenantId: string;
    isPrimary: boolean;
  }): Promise<CustomDomain> {
    // Demote any existing primary first when this row is becoming primary.
    // Use a single transaction so the unique partial index can't see two
    // primaries mid-flight.
    const row = await this.sql.begin(async (sql) => {
      if (input.isPrimary) {
        await sql`
          UPDATE control_plane.custom_domains
          SET is_primary = FALSE
          WHERE tenant_id = ${input.tenantId}
            AND is_primary = TRUE
        `;
      }
      const inserted = await sql<CustomDomainRow[]>`
        INSERT INTO control_plane.custom_domains (
          hostname, tenant_id, status, is_primary
        ) VALUES (
          ${input.hostname},
          ${input.tenantId},
          'active',
          ${input.isPrimary}
        )
        RETURNING hostname, tenant_id, status, is_primary, created_at
      `;
      const r = inserted[0];
      if (!r) throw new Error('insert returned no row');
      return r;
    });
    return rowToDomain(row);
  }

  async disable(hostname: string): Promise<void> {
    await this.sql`
      UPDATE control_plane.custom_domains
      SET status = 'disabled', is_primary = FALSE
      WHERE hostname = ${hostname}
    `;
  }
}
