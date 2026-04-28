/**
 * PostgresCatalogStateStore — Postgres-backed `CatalogStateStore`.
 *
 * Schema is installed by the bundled migration
 * `migrations/tenant/20260428000004_catalog_state.sql` (run via the
 * adapters-node migration runner).
 *
 * One row per tenant (the IDB shape is also keyed on `tenantId`). `put`
 * is INSERT ... ON CONFLICT (tenant_id) DO UPDATE.
 */

import type { CatalogStateRecord, CatalogStateStore } from '@atlas/ports';
import type postgres from 'postgres';

interface CatalogStateRow {
  tenant_id: string;
  seed_package_key: string;
  seed_package_version: string;
  payload: unknown;
  published_revisions: Record<string, number> | null;
}

export class PostgresCatalogStateStore implements CatalogStateStore {
  constructor(private readonly sql: postgres.Sql) {}

  async get(tenantId: string): Promise<CatalogStateRecord | null> {
    const rows = await this.sql<CatalogStateRow[]>`
      SELECT tenant_id, seed_package_key, seed_package_version,
             payload, published_revisions
      FROM catalog_state
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      seedPackageKey: row.seed_package_key,
      seedPackageVersion: row.seed_package_version,
      payload: row.payload,
      publishedRevisions: row.published_revisions ?? {},
    };
  }

  async put(record: CatalogStateRecord): Promise<void> {
    await this.sql`
      INSERT INTO catalog_state (
        tenant_id, seed_package_key, seed_package_version,
        payload, published_revisions, updated_at
      ) VALUES (
        ${record.tenantId},
        ${record.seedPackageKey},
        ${record.seedPackageVersion},
        ${this.sql.json(record.payload as never)},
        ${this.sql.json(record.publishedRevisions)},
        now()
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        seed_package_key = EXCLUDED.seed_package_key,
        seed_package_version = EXCLUDED.seed_package_version,
        payload = EXCLUDED.payload,
        published_revisions = EXCLUDED.published_revisions,
        updated_at = now()
    `;
  }
}
