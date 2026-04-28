/**
 * PostgresSearchEngine — Postgres-backed `SearchEngine` adapter.
 *
 * TypeScript port of `crates/adapters/src/postgres_search.rs`. Reuses the
 * `catalog_search_documents` table from
 * `crates/tenant_db/migrations/20260427000001_catalog_search_documents.sql`
 * (copied verbatim into `migrations/tenant/`).
 *
 * Wiring:
 * - The adapter is constructed with a `postgres.Sql` for a single tenant
 *   DB (typically obtained from `TenantDbProvider.getPool(tenantId)`).
 *   Tenant isolation is enforced by the `tenant_id` column in WHERE clauses
 *   — same as the Rust adapter, which uses one physical DB per tenant.
 * - `index` upserts on `(tenant_id, document_type, document_id)`.
 * - `search` runs `plainto_tsquery + ts_rank` ordered DESC, with
 *   permission-attribute filtering at the SQL layer. Empty query yields
 *   `[]` because `plainto_tsquery('english', '')` produces an empty
 *   tsquery that `@@` never matches.
 * - `deleteByDocument` removes a single row by composite key.
 *
 * Field mapping mirrors the Rust adapter's `index` path:
 *   - `title`, `summary`, `body_text`, `taxonomy_path` map to dedicated
 *     columns (used by the generated `search_vector`).
 *   - everything else in `SearchDocument.fields` (excluding `_sort` and
 *     `_score`) goes into `filter_values` jsonb.
 *   - `_sort` (if present) lands in `sort_values`.
 *   - `_score` is added on read.
 */

import type { SearchDocument } from '@atlas/platform-core';
import type { SearchEngine } from '@atlas/ports';
import type postgres from 'postgres';

const DEFAULT_LIMIT = 100;

interface RawSearchRow {
  document_type: string;
  document_id: string;
  title: string;
  summary: string | null;
  body_text: string | null;
  taxonomy_path: string | null;
  permission_attributes: { allowedPrincipals?: unknown } | null;
  filter_values: Record<string, unknown> | null;
  sort_values: Record<string, unknown> | null;
  rank: number;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function parsePermissionAttrs(
  v: { allowedPrincipals?: unknown } | null,
): { allowedPrincipals: string[] } | null {
  if (v == null) return null;
  const arr = v.allowedPrincipals;
  if (!Array.isArray(arr)) return null;
  const principals = arr.filter((x): x is string => typeof x === 'string');
  return { allowedPrincipals: principals };
}

export class PostgresSearchEngine implements SearchEngine {
  constructor(private readonly sql: postgres.Sql) {}

  async index(doc: SearchDocument): Promise<void> {
    const title = asString(doc.fields['title']);
    if (title === null) {
      throw new Error(
        `search document ${doc.documentType}/${doc.documentId} missing required string field 'title'`,
      );
    }
    const summary = asString(doc.fields['summary']);
    const bodyText = asString(doc.fields['body_text']);
    const taxonomyPath = asString(doc.fields['taxonomy_path']);

    const filterValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      if (
        k === 'title' ||
        k === 'summary' ||
        k === 'body_text' ||
        k === 'taxonomy_path' ||
        k === '_sort' ||
        k === '_score'
      ) {
        continue;
      }
      filterValues[k] = v;
    }

    const sortValues = (doc.fields['_sort'] as Record<string, unknown> | undefined) ?? {};

    const permissionJson = doc.permissionAttributes
      ? { allowedPrincipals: doc.permissionAttributes.allowedPrincipals }
      : null;

    await this.sql`
      INSERT INTO catalog_search_documents (
        tenant_id, document_type, document_id, title, summary, body_text,
        taxonomy_path, permission_attributes, filter_values, sort_values,
        updated_at
      ) VALUES (
        ${doc.tenantId},
        ${doc.documentType},
        ${doc.documentId},
        ${title},
        ${summary},
        ${bodyText},
        ${taxonomyPath},
        ${permissionJson === null ? null : this.sql.json(permissionJson as never)},
        ${this.sql.json(filterValues as never)},
        ${this.sql.json(sortValues as never)},
        now()
      )
      ON CONFLICT (tenant_id, document_type, document_id) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        body_text = EXCLUDED.body_text,
        taxonomy_path = EXCLUDED.taxonomy_path,
        permission_attributes = EXCLUDED.permission_attributes,
        filter_values = EXCLUDED.filter_values,
        sort_values = EXCLUDED.sort_values,
        updated_at = now()
    `;
  }

  async deleteByDocument(
    tenantId: string,
    documentType: string,
    documentId: string,
  ): Promise<void> {
    await this.sql`
      DELETE FROM catalog_search_documents
      WHERE tenant_id = ${tenantId}
        AND document_type = ${documentType}
        AND document_id = ${documentId}
    `;
  }

  async search(
    query: string,
    tenantId: string,
    principalId: string,
  ): Promise<SearchDocument[]> {
    return this.searchPaginated(query, tenantId, principalId, DEFAULT_LIMIT, 0);
  }

  async searchPaginated(
    query: string,
    tenantId: string,
    principalId: string,
    limit: number,
    offset: number,
  ): Promise<SearchDocument[]> {
    const rows = await this.sql<RawSearchRow[]>`
      SELECT document_type, document_id, title, summary, body_text, taxonomy_path,
             permission_attributes, filter_values, sort_values,
             ts_rank(search_vector, plainto_tsquery('english', ${query})) AS rank
      FROM catalog_search_documents
      WHERE tenant_id = ${tenantId}
        AND search_vector @@ plainto_tsquery('english', ${query})
        AND (permission_attributes IS NULL
             OR permission_attributes->'allowedPrincipals' IS NULL
             OR permission_attributes->'allowedPrincipals' ? ${principalId})
      ORDER BY rank DESC, document_id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return rows.map((row): SearchDocument => {
      const fields: Record<string, unknown> = {
        title: row.title,
      };
      if (row.summary !== null) fields['summary'] = row.summary;
      if (row.body_text !== null) fields['body_text'] = row.body_text;
      if (row.taxonomy_path !== null) fields['taxonomy_path'] = row.taxonomy_path;

      if (row.filter_values && typeof row.filter_values === 'object') {
        for (const [k, v] of Object.entries(row.filter_values)) {
          if (!(k in fields)) fields[k] = v;
        }
      }
      if (
        row.sort_values &&
        typeof row.sort_values === 'object' &&
        Object.keys(row.sort_values).length > 0
      ) {
        fields['_sort'] = row.sort_values;
      }
      fields['_score'] = row.rank;

      return {
        documentId: row.document_id,
        documentType: row.document_type,
        tenantId,
        fields,
        permissionAttributes: parsePermissionAttrs(row.permission_attributes),
      };
    });
  }
}
