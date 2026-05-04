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

import type {
  EntityTypeRow,
  FieldRow,
  IndexDeclarationRow,
  RegistryOrigin,
} from '@atlas/platform-core';
import type { EntityTypeRegistry } from '@atlas/ports';
import type postgres from 'postgres';

interface EntityTypeDbRow {
  entity_type: string;
  tenant_id: string | null;
  schema_version: number;
  json_schema: unknown;
  origin: string;
  package_id: string | null;
  created_at: string;
}

interface FieldDbRow {
  entity_type: string;
  tenant_id: string | null;
  field_path: string;
  data_type: string;
  label: string | null;
  help_text: string | null;
  is_required: boolean;
  default_value: unknown;
  constraints: unknown;
  origin: string;
  package_id: string | null;
  created_at: string;
}

interface IndexDbRow {
  entity_type: string;
  tenant_id: string | null;
  index_name: string;
  field_paths: unknown;
  is_unique: boolean;
  where_clause: unknown;
  origin: string;
  package_id: string | null;
  created_at: string;
}

function entityTypeRow(r: EntityTypeDbRow): EntityTypeRow {
  return {
    entity_type: r.entity_type,
    tenant_id: r.tenant_id,
    schema_version: r.schema_version,
    json_schema: r.json_schema as EntityTypeRow['json_schema'],
    origin: r.origin as RegistryOrigin,
    package_id: r.package_id,
    created_at: r.created_at,
  };
}

function fieldRow(r: FieldDbRow): FieldRow {
  return {
    entity_type: r.entity_type,
    tenant_id: r.tenant_id,
    field_path: r.field_path,
    data_type: r.data_type,
    label: r.label,
    help_text: r.help_text,
    is_required: r.is_required,
    default_value: r.default_value as FieldRow['default_value'],
    constraints: r.constraints as FieldRow['constraints'],
    origin: r.origin as RegistryOrigin,
    package_id: r.package_id,
    created_at: r.created_at,
  };
}

function indexRow(r: IndexDbRow): IndexDeclarationRow {
  return {
    entity_type: r.entity_type,
    tenant_id: r.tenant_id,
    index_name: r.index_name,
    field_paths: Array.isArray(r.field_paths) ? (r.field_paths as string[]) : [],
    is_unique: r.is_unique,
    where_clause: r.where_clause as IndexDeclarationRow['where_clause'],
    origin: r.origin as RegistryOrigin,
    package_id: r.package_id,
    created_at: r.created_at,
  };
}

export class PostgresEntityTypeRegistry implements EntityTypeRegistry {
  constructor(private readonly sql: postgres.Sql) {}

  async getEntityType(
    entityType: string,
    tenantId: string,
  ): Promise<EntityTypeRow | null> {
    // Prefer the tenant-specific row; fall back to platform default.
    // Single round-trip via DISTINCT ON.
    const rows = await this.sql<EntityTypeDbRow[]>`
      SELECT DISTINCT ON (entity_type)
        entity_type, tenant_id, schema_version, json_schema,
        origin, package_id, created_at
      FROM control_plane.entity_type_registry
      WHERE entity_type = ${entityType}
        AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
      ORDER BY entity_type, tenant_id NULLS LAST
      LIMIT 1
    `;
    const row = rows[0];
    return row ? entityTypeRow(row) : null;
  }

  async listEntityTypes(tenantId: string): Promise<EntityTypeRow[]> {
    const rows = await this.sql<EntityTypeDbRow[]>`
      SELECT DISTINCT ON (entity_type)
        entity_type, tenant_id, schema_version, json_schema,
        origin, package_id, created_at
      FROM control_plane.entity_type_registry
      WHERE tenant_id = ${tenantId} OR tenant_id IS NULL
      ORDER BY entity_type, tenant_id NULLS LAST
    `;
    return rows.map(entityTypeRow);
  }

  async listFields(
    entityType: string,
    tenantId: string,
  ): Promise<FieldRow[]> {
    // Per field_path: tenant override wins; otherwise platform default.
    const rows = await this.sql<FieldDbRow[]>`
      SELECT DISTINCT ON (entity_type, field_path)
        entity_type, tenant_id, field_path, data_type, label, help_text,
        is_required, default_value, constraints, origin, package_id, created_at
      FROM control_plane.field_registry
      WHERE entity_type = ${entityType}
        AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
      ORDER BY entity_type, field_path, tenant_id NULLS LAST
    `;
    return rows.map(fieldRow);
  }

  async listIndexes(
    entityType: string,
    tenantId: string | null,
  ): Promise<IndexDeclarationRow[]> {
    const rows = await this.sql<IndexDbRow[]>`
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
    const rows = await this.sql<IndexDbRow[]>`
      SELECT entity_type, tenant_id, index_name, field_paths, is_unique,
             where_clause, origin, package_id, created_at
      FROM control_plane.index_registry
      WHERE tenant_id IS NULL
      ORDER BY entity_type, index_name
    `;
    return rows.map(indexRow);
  }
}
