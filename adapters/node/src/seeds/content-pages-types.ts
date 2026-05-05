/**
 * Platform-default registry rows for the Page + PageRenderTree entity
 * types. Lives in @atlas/adapter-node so the postgres.js dependency
 * stays confined to the adapter package. Wired into the control-plane
 * seed runner (`../migrations/seed.ts`).
 *
 * `tenant_id IS NULL` means "platform default, inherited by every
 * tenant." Tenant customization writes non-NULL rows that shadow these
 * defaults per-tenant; the entity-type registry resolves "tenant
 * override > platform default" automatically.
 *
 * Idempotent: every INSERT uses `ON CONFLICT DO NOTHING`.
 */

import type postgres from 'postgres';
import {
  PAGE_ENTITY_TYPE,
  PAGE_LATEST_VERSION,
  PAGE_RENDER_TREE_ENTITY_TYPE,
  PAGE_RENDER_TREE_LATEST_VERSION,
} from '@atlas/content-pages';

const PAGE_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'content-pages.page.v1',
  type: 'object',
  required: ['pageId', 'tenantId', 'title', 'slug', 'status', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    pageId: { type: 'string' },
    tenantId: { type: 'string' },
    title: { type: 'string' },
    slug: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'published', 'archived'] },
    content: { type: 'string' },
    authorId: { type: ['string', 'null'] },
    templateId: { type: 'string' },
    templateVersion: { type: 'string' },
    pluginRef: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const PAGE_RENDER_TREE_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'content-pages.page_render_tree.v1',
  type: 'object',
  required: ['pageId', 'version', 'nodes', 'builtAt'],
  additionalProperties: false,
  properties: {
    pageId: { type: 'string' },
    version: { const: 1 },
    nodes: { type: 'array' },
    pluginId: { type: 'string' },
    pluginVersion: { type: 'string' },
    builtAt: { type: 'string', format: 'date-time' },
  },
} as const;

export async function seedContentPagesEntityTypes(
  sql: postgres.Sql,
): Promise<void> {
  // ----- entity_type_registry --------------------------------------
  await sql`
    INSERT INTO control_plane.entity_type_registry
      (entity_type, tenant_id, schema_version, json_schema, origin)
    VALUES
      (${PAGE_ENTITY_TYPE}, NULL, ${PAGE_LATEST_VERSION},
       ${sql.json(PAGE_JSON_SCHEMA as never)}, 'platform'),
      (${PAGE_RENDER_TREE_ENTITY_TYPE}, NULL, ${PAGE_RENDER_TREE_LATEST_VERSION},
       ${sql.json(PAGE_RENDER_TREE_JSON_SCHEMA as never)}, 'platform')
    ON CONFLICT (entity_type, tenant_id) DO NOTHING
  `;

  // ----- field_registry --------------------------------------------
  await sql`
    INSERT INTO control_plane.field_registry
      (entity_type, tenant_id, field_path, data_type, label, is_required, origin)
    VALUES
      (${PAGE_ENTITY_TYPE}, NULL, 'pageId',     'string',  'Page ID',  TRUE,  'platform'),
      (${PAGE_ENTITY_TYPE}, NULL, 'title',      'string',  'Title',    TRUE,  'platform'),
      (${PAGE_ENTITY_TYPE}, NULL, 'slug',       'string',  'Slug',     TRUE,  'platform'),
      (${PAGE_ENTITY_TYPE}, NULL, 'status',     'enum',    'Status',   TRUE,  'platform'),
      (${PAGE_ENTITY_TYPE}, NULL, 'content',    'string',  'Content',  FALSE, 'platform'),
      (${PAGE_ENTITY_TYPE}, NULL, 'authorId',   'string',  'Author',   FALSE, 'platform'),
      (${PAGE_ENTITY_TYPE}, NULL, 'updatedAt',  'date',    'Updated',  TRUE,  'platform')
    ON CONFLICT (entity_type, tenant_id, field_path) DO NOTHING
  `;

  await sql`
    INSERT INTO control_plane.field_registry
      (entity_type, tenant_id, field_path, data_type, label, is_required, origin)
    VALUES
      (${PAGE_RENDER_TREE_ENTITY_TYPE}, NULL, 'pageId',  'string', 'Page ID', TRUE, 'platform'),
      (${PAGE_RENDER_TREE_ENTITY_TYPE}, NULL, 'builtAt', 'date',   'Built',   TRUE, 'platform')
    ON CONFLICT (entity_type, tenant_id, field_path) DO NOTHING
  `;

  // ----- index_registry --------------------------------------------
  await sql`
    INSERT INTO control_plane.index_registry
      (entity_type, tenant_id, index_name, field_paths, is_unique, where_clause, origin)
    VALUES
      (${PAGE_ENTITY_TYPE}, NULL, 'slug',
       ${sql.json(['slug'] as never)}, TRUE, NULL, 'platform'),
      (${PAGE_ENTITY_TYPE}, NULL, 'status',
       ${sql.json(['status'] as never)}, FALSE, NULL, 'platform')
    ON CONFLICT (entity_type, tenant_id, index_name) DO NOTHING
  `;
}
