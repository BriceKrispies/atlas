/**
 * IdbEntityStore — IndexedDB-backed `EntityStore` for the sim path.
 *
 * Mirrors `PostgresEntityStore` semantics: composite key
 * `(tenantId, entityType, entityId)`, JSONB-shaped `attrs`, soft delete
 * via `status='deleted'`, list-by-type filter on status. Works in both
 * the browser (real `window.indexedDB`) and Node tests
 * (`fake-indexeddb`).
 */

import type {
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStatus,
  EntityStore,
  EntityWriteInput,
} from '@atlas/ports';
import { entityKey, type EntityRow, type IdbDb } from './db.ts';

const DEFAULT_LIMIT = 100;

function rowToEntity<TAttrs>(row: EntityRow): Entity<TAttrs> {
  return {
    tenantId: row.tenantId,
    entityType: row.entityType,
    entityId: row.entityId,
    schemaVersion: row.schemaVersion,
    attrs: row.attrs as TAttrs,
    status: row.status as EntityStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function attrsContains(attrs: unknown, predicate: Record<string, unknown>): boolean {
  if (!attrs || typeof attrs !== 'object') return false;
  const a = attrs as Record<string, unknown>;
  for (const [k, v] of Object.entries(predicate)) {
    if (a[k] !== v) return false;
  }
  return true;
}

export class IdbEntityStore implements EntityStore {
  constructor(private readonly db: IdbDb) {}

  async get<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<Entity<TAttrs> | null> {
    const row = await this.db.get('entities', entityKey(tenantId, entityType, entityId));
    return row ? rowToEntity<TAttrs>(row) : null;
  }

  async put<TAttrs = unknown>(
    input: EntityWriteInput<TAttrs>,
  ): Promise<Entity<TAttrs>> {
    const key = entityKey(input.tenantId, input.entityType, input.entityId);
    const existing = await this.db.get('entities', key);
    const now = nowIso();
    const row: EntityRow = {
      entityKey: key,
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      schemaVersion: input.schemaVersion ?? 1,
      attrs: input.attrs,
      status: input.status ?? 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.db.put('entities', row);
    return rowToEntity<TAttrs>(row);
  }

  async delete(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    const key = entityKey(tenantId, entityType, entityId);
    const existing = await this.db.get('entities', key);
    if (!existing) return;
    await this.db.put('entities', {
      ...existing,
      status: 'deleted',
      updatedAt: nowIso(),
    });
  }

  async list<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts: EntityListOptions = {},
  ): Promise<Entity<TAttrs>[]> {
    const status = opts.status === undefined ? 'active' : opts.status;
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const after = opts.after ?? '';
    const range = IDBKeyRange.bound([tenantId, entityType], [tenantId, entityType, '￿']);
    const all = await this.db.getAllFromIndex('entities', 'by_tenant_type', range);
    const filtered = all
      .filter((r) => (status === null ? true : r.status === status))
      .filter((r) => (after === '' ? true : r.entityId > after))
      .sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0))
      .slice(0, limit);
    return filtered.map((r) => rowToEntity<TAttrs>(r));
  }

  async query<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts: EntityQueryOptions,
  ): Promise<Entity<TAttrs>[]> {
    const base = await this.list<TAttrs>(tenantId, entityType, opts);
    if (!opts.attrsEqual || Object.keys(opts.attrsEqual).length === 0) {
      return base;
    }
    return base.filter((e) => attrsContains(e.attrs, opts.attrsEqual!));
  }
}
