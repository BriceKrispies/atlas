/**
 * PostgresRelationStore — Postgres-backed `RelationStore`.
 *
 * Schema is installed by `migrations/tenant/20260503000002_entities_and_relations.sql`.
 */

import type {
  Relation,
  RelationStore,
  RelationWriteInput,
} from '@atlas/ports';
import type postgres from 'postgres';

interface RelationRow {
  tenant_id: string;
  edge_type: string;
  from_id: string;
  to_id: string;
  attrs: unknown;
  created_at: string;
}

function rowToRelation<TAttrs>(row: RelationRow): Relation<TAttrs> {
  return {
    tenantId: row.tenant_id,
    edgeType: row.edge_type,
    fromId: row.from_id,
    toId: row.to_id,
    attrs: (row.attrs ?? null) as TAttrs | null,
    createdAt: row.created_at,
  };
}

export class PostgresRelationStore implements RelationStore {
  constructor(private readonly sql: postgres.Sql) {}

  async add<TAttrs = unknown>(
    input: RelationWriteInput<TAttrs>,
  ): Promise<Relation<TAttrs>> {
    const attrs = input.attrs ?? null;
    const rows = await this.sql<RelationRow[]>`
      INSERT INTO relations (
        tenant_id, edge_type, from_id, to_id, attrs
      ) VALUES (
        ${input.tenantId},
        ${input.edgeType},
        ${input.fromId},
        ${input.toId},
        ${attrs === null ? null : this.sql.json(attrs as never)}
      )
      ON CONFLICT (tenant_id, edge_type, from_id, to_id) DO UPDATE SET
        attrs = EXCLUDED.attrs
      RETURNING tenant_id, edge_type, from_id, to_id, attrs, created_at
    `;
    const row = rows[0];
    if (!row) throw new Error('relation add returned no row');
    return rowToRelation<TAttrs>(row);
  }

  async remove(
    tenantId: string,
    edgeType: string,
    fromId: string,
    toId: string,
  ): Promise<void> {
    await this.sql`
      DELETE FROM relations
      WHERE tenant_id = ${tenantId}
        AND edge_type = ${edgeType}
        AND from_id = ${fromId}
        AND to_id = ${toId}
    `;
  }

  async outgoing<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    fromId: string,
  ): Promise<Relation<TAttrs>[]> {
    const rows = await this.sql<RelationRow[]>`
      SELECT tenant_id, edge_type, from_id, to_id, attrs, created_at
      FROM relations
      WHERE tenant_id = ${tenantId}
        AND edge_type = ${edgeType}
        AND from_id = ${fromId}
      ORDER BY to_id ASC
    `;
    return rows.map((r) => rowToRelation<TAttrs>(r));
  }

  async incoming<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    toId: string,
  ): Promise<Relation<TAttrs>[]> {
    const rows = await this.sql<RelationRow[]>`
      SELECT tenant_id, edge_type, from_id, to_id, attrs, created_at
      FROM relations
      WHERE tenant_id = ${tenantId}
        AND edge_type = ${edgeType}
        AND to_id = ${toId}
      ORDER BY from_id ASC
    `;
    return rows.map((r) => rowToRelation<TAttrs>(r));
  }
}
