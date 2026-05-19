/**
 * PostgresEntityTypeRegistry — read-side view of the L3 metadata
 * registries (`entity_type_registry`, `field_registry`, `index_registry`).
 *
 * Resolution rule: tenant override > platform default. The query for
 * `getEntityType` selects the tenant-specific row when one exists,
 * otherwise the `tenant_id IS NULL` row. `listFields` does the same per
 * field_path, so a tenant adding a single custom field doesn't replace
 * the entire field set.
 *
 * Phase A only writes platform defaults (tenant_id NULL); the override
 * resolution is in place from day one so Phase F can populate
 * tenant-specific rows without retrofitting the read path.
 */
import type { EntityTypeRow, FieldRow, IndexDeclarationRow, JsonValue, } from '@atlas/platform-core';
import type { EntityTypeRegistry } from '@atlas/ports';
import type postgres from 'postgres';
/**
 * DB row shape for `control_plane.index_registry`. Identical to
 * `IndexDeclarationRow` except `field_paths` is a raw `JsonValue` —
 * postgres.js parses the JSONB column, but `string[]` is narrower than
 * what JSONB allows on the wire, so we keep the wider type at the
 * trust boundary and narrow it inside `indexRow()`.
 *
 * For the entity-type / field rows, the typed-row generic on `sql<…>`
 * matches the domain row exactly: `json_schema` / `default_value` /
 * `constraints` are JSONB columns (postgres.js parses → `JsonValue`),
 * and `origin` is enforced by a DB-level CHECK constraint
 * (`'platform' | 'tenant' | 'package'`) so the enum type holds without
 * a runtime check on the read path.
 */
interface IndexDbRow extends Omit<IndexDeclarationRow, 'field_paths'> {
    field_paths: JsonValue;
}
function indexRow(r: IndexDbRow): IndexDeclarationRow {
    // JSONB array — narrow to string[] defensively (the DB column is
    // typed JSONB rather than text[] so non-string entries are theoretically
    // representable; the writer never produces them, but the reader stays
    // permissive).
    const fieldPaths = Array.isArray(r.field_paths)
        ? r.field_paths.filter(function (p): p is string {
            return typeof p === 'string';
        })
        : [];
    return {
        entity_type: r.entity_type,
        tenant_id: r.tenant_id,
        index_name: r.index_name,
        field_paths: fieldPaths,
        is_unique: r.is_unique,
        where_clause: r.where_clause,
        origin: r.origin,
        package_id: r.package_id,
        created_at: r.created_at,
    };
}
export class PostgresEntityTypeRegistry implements EntityTypeRegistry {
    constructor(private readonly sql: postgres.Sql) { }
    async getEntityType(entityType: string, tenantId: string): Promise<EntityTypeRow | null> {
        // Prefer the tenant-specific row; fall back to platform default.
        // Single round-trip via DISTINCT ON.
        const rows = await this.sql<EntityTypeRow[]> `
      SELECT DISTINCT ON (entity_type)
        entity_type, tenant_id, schema_version, json_schema,
        origin, package_id, created_at
      FROM control_plane.entity_type_registry
      WHERE entity_type = ${entityType}
        AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
      ORDER BY entity_type, tenant_id NULLS LAST
      LIMIT 1
    `;
        return rows[0] ?? null;
    }
    async listEntityTypes(tenantId: string): Promise<EntityTypeRow[]> {
        return this.sql<EntityTypeRow[]> `
      SELECT DISTINCT ON (entity_type)
        entity_type, tenant_id, schema_version, json_schema,
        origin, package_id, created_at
      FROM control_plane.entity_type_registry
      WHERE tenant_id = ${tenantId} OR tenant_id IS NULL
      ORDER BY entity_type, tenant_id NULLS LAST
    `;
    }
    async listFields(entityType: string, tenantId: string): Promise<FieldRow[]> {
        // Per field_path: tenant override wins; otherwise platform default.
        return this.sql<FieldRow[]> `
      SELECT DISTINCT ON (entity_type, field_path)
        entity_type, tenant_id, field_path, data_type, label, help_text,
        is_required, default_value, constraints, origin, package_id, created_at
      FROM control_plane.field_registry
      WHERE entity_type = ${entityType}
        AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
      ORDER BY entity_type, field_path, tenant_id NULLS LAST
    `;
    }
    async listIndexes(entityType: string, tenantId: string | null): Promise<IndexDeclarationRow[]> {
        const rows = await this.sql<IndexDbRow[]> `
      SELECT entity_type, tenant_id, index_name, field_paths, is_unique,
             where_clause, origin, package_id, created_at
      FROM control_plane.index_registry
      WHERE entity_type = ${entityType}
        AND tenant_id IS NOT DISTINCT FROM ${tenantId}
      ORDER BY index_name
    `;
        return rows.map(indexRow);
    }
    async listAllPlatformIndexes(): Promise<IndexDeclarationRow[]> {
        const rows = await this.sql<IndexDbRow[]> `
      SELECT entity_type, tenant_id, index_name, field_paths, is_unique,
             where_clause, origin, package_id, created_at
      FROM control_plane.index_registry
      WHERE tenant_id IS NULL
      ORDER BY entity_type, index_name
    `;
        return rows.map(indexRow);
    }
}
