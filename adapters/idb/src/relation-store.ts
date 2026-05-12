/**
 * IdbRelationStore — IndexedDB-backed `RelationStore` for the sim path.
 *
 * Mirrors `PostgresRelationStore` semantics: composite key
 * `(tenantId, edgeType, fromId, toId)`. Bidirectional traversal via the
 * two indexes on the underlying object store.
 */

import type {
  Relation,
  RelationStore,
  RelationWriteInput,
} from '@atlas/ports';
import { relationKey, type IdbDb, type RelationRow } from './db.ts';

function rowToRelation<TAttrs>(row: RelationRow): Relation<TAttrs> {
  return {
    tenantId: row.tenantId,
    edgeType: row.edgeType,
    fromId: row.fromId,
    toId: row.toId,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- storage layer: relations store attrs as opaque JSON; the caller declares the expected `TAttrs` shape (same pattern as the postgres counterpart in adapters/node/src/relation-store.ts).
    attrs: (row.attrs ?? null) as TAttrs | null,
    createdAt: row.createdAt,
  };
}

export class IdbRelationStore implements RelationStore {
  constructor(private readonly db: IdbDb) {}

  async add<TAttrs = unknown>(
    input: RelationWriteInput<TAttrs>,
  ): Promise<Relation<TAttrs>> {
    const key = relationKey(input.tenantId, input.edgeType, input.fromId, input.toId);
    const existing = await this.db.get('relations', key);
    const row: RelationRow = {
      relationKey: key,
      tenantId: input.tenantId,
      edgeType: input.edgeType,
      fromId: input.fromId,
      toId: input.toId,
      attrs: input.attrs ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await this.db.put('relations', row);
    return rowToRelation<TAttrs>(row);
  }

  async remove(
    tenantId: string,
    edgeType: string,
    fromId: string,
    toId: string,
  ): Promise<void> {
    await this.db.delete('relations', relationKey(tenantId, edgeType, fromId, toId));
  }

  async outgoing<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    fromId: string,
  ): Promise<Relation<TAttrs>[]> {
    const range = IDBKeyRange.only([tenantId, edgeType, fromId]);
    const rows = await this.db.getAllFromIndex('relations', 'by_tenant_edge_from', range);
    return rows
      .sort((a, b) => (a.toId < b.toId ? -1 : a.toId > b.toId ? 1 : 0))
      .map((r) => rowToRelation<TAttrs>(r));
  }

  async incoming<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    toId: string,
  ): Promise<Relation<TAttrs>[]> {
    const range = IDBKeyRange.only([tenantId, edgeType, toId]);
    const rows = await this.db.getAllFromIndex('relations', 'by_tenant_edge_to', range);
    return rows
      .sort((a, b) => (a.fromId < b.fromId ? -1 : a.fromId > b.fromId ? 1 : 0))
      .map((r) => rowToRelation<TAttrs>(r));
  }
}
