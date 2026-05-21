/**
 * PostgresEntityStore — Postgres-backed `EntityStore`.
 *
 * Schema is installed by `migrations/tenant/20260503000002_entities_and_relations.sql`.
 * Per-attribute indexes are managed by the index materializer at boot —
 * this adapter doesn't create or assume any beyond the baseline
 * `(tenant_id, entity_type, status)` and the GIN on `attrs`.
 *
 * Upcasting is not done here — callers (or a thin wrapper) apply
 * upcasters from `@atlas/platform-core/upcaster` after `get`/`list`/`query`.
 * Keeping the adapter pure makes it easier to test against canned rows.
 */
import type { Entity, EntityListOptions, EntityQueryOptions, EntityStore, EntityStatus, EntityWriteInput, } from '@atlas/ports';
import type postgres from 'postgres';
import { jsonParam } from './seeds/sql-json.ts';
interface EntityRow {
    tenant_id: string;
    entity_type: string;
    entity_id: string;
    schema_version: number;
    attrs: unknown;
    status: string;
    created_at: string;
    updated_at: string;
}
function toEntityStatus(raw: string): EntityStatus {
    // Defensive narrow at the DB boundary. The `entities.status` column is
    // CHECK-constrained to the same three values in the migration; any
    // surprise here is a schema-drift bug, not a runtime fall-through.
    switch (raw) {
        case 'active':
        case 'archived':
        case 'deleted':
            return raw;
        default:
            throw new Error(`entity row carries unknown status: ${raw}`);
    }
}
function rowToEntity<TAttrs>(row: EntityRow): Entity<TAttrs> {
    return {
        tenantId: row.tenant_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        schemaVersion: row.schema_version,
        // Boundary: `attrs` is JSONB on disk and `unknown` in the row type.
        // The contract is "callers know their entity_type's attrs schema and
        // pass the matching `TAttrs`" — same shape as the `idb` adapter's
        // mirror (`adapters/idb/src/entity-store.ts:29`). Per-entity-type
        // validation happens in the entity-wrapper layer in `@atlas/identity`
        // / `@atlas/content-pages`.
        attrs: row.attrs as TAttrs,
        status: toEntityStatus(row.status),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
const DEFAULT_LIMIT = 100;
export class PostgresEntityStore implements EntityStore {
    /**
     * Optional default schema version per entity type. If a `put` doesn't
     * specify `schemaVersion`, the adapter uses the registered version
     * here. Tests / migration scripts that bypass this map can still pin
     * an explicit version on each write.
     */
    constructor(private readonly sql: postgres.Sql, private readonly latestVersionByType: Map<string, number> = new Map()) { }
    async get<TAttrs = unknown>(tenantId: string, entityType: string, entityId: string): Promise<Entity<TAttrs> | null> {
        const rows = await this.sql<EntityRow[]> `
      SELECT tenant_id, entity_type, entity_id, schema_version,
             attrs, status, created_at, updated_at
      FROM entities
      WHERE tenant_id = ${tenantId}
        AND entity_type = ${entityType}
        AND entity_id = ${entityId}
      LIMIT 1
    `;
        const row = rows[0];
        return row ? rowToEntity<TAttrs>(row) : null;
    }
    async put<TAttrs = unknown>(input: EntityWriteInput<TAttrs>): Promise<Entity<TAttrs>> {
        const version = input.schemaVersion ?? this.latestVersionByType.get(input.entityType) ?? 1;
        const status = input.status ?? 'active';
        const rows = await this.sql<EntityRow[]> `
      INSERT INTO entities (
        tenant_id, entity_type, entity_id, schema_version, attrs, status, updated_at
      ) VALUES (
        ${input.tenantId},
        ${input.entityType},
        ${input.entityId},
        ${version},
        ${jsonParam(this.sql, input.attrs)},
        ${status},
        now()
      )
      ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
        schema_version = EXCLUDED.schema_version,
        attrs          = EXCLUDED.attrs,
        status         = EXCLUDED.status,
        updated_at     = now()
      RETURNING tenant_id, entity_type, entity_id, schema_version,
                attrs, status, created_at, updated_at
    `;
        const row = rows[0];
        if (!row)
            throw new Error('entity put returned no row');
        return rowToEntity<TAttrs>(row);
    }
    async delete(tenantId: string, entityType: string, entityId: string): Promise<void> {
        await this.sql `
      UPDATE entities
      SET status = 'deleted', updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND entity_type = ${entityType}
        AND entity_id = ${entityId}
    `;
    }
    async list<TAttrs = unknown>(tenantId: string, entityType: string, opts: EntityListOptions = {}): Promise<Entity<TAttrs>[]> {
        const status = opts.status === undefined ? 'active' : opts.status;
        const limit = opts.limit ?? DEFAULT_LIMIT;
        const after = opts.after ?? '';
        const rows = await this.sql<EntityRow[]> `
      SELECT tenant_id, entity_type, entity_id, schema_version,
             attrs, status, created_at, updated_at
      FROM entities
      WHERE tenant_id = ${tenantId}
        AND entity_type = ${entityType}
        ${status === null
            ? this.sql ``
            : this.sql `AND status = ${status}`}
        ${after === '' ? this.sql `` : this.sql `AND entity_id > ${after}`}
      ORDER BY entity_id ASC
      LIMIT ${limit}
    `;
        return rows.map(function (r) {
            return rowToEntity<TAttrs>(r);
        });
    }
    async query<TAttrs = unknown>(tenantId: string, entityType: string, opts: EntityQueryOptions): Promise<Entity<TAttrs>[]> {
        const status = opts.status === undefined ? 'active' : opts.status;
        const limit = opts.limit ?? DEFAULT_LIMIT;
        const after = opts.after ?? '';
        // Build a JSONB containment predicate for attrsEqual. Single round-trip,
        // uses the GIN index on attrs.
        const containment = opts.attrsEqual && Object.keys(opts.attrsEqual).length > 0
            ? opts.attrsEqual
            : null;
        const rows = await this.sql<EntityRow[]> `
      SELECT tenant_id, entity_type, entity_id, schema_version,
             attrs, status, created_at, updated_at
      FROM entities
      WHERE tenant_id = ${tenantId}
        AND entity_type = ${entityType}
        ${status === null
            ? this.sql ``
            : this.sql `AND status = ${status}`}
        ${containment
            ? this.sql `AND attrs @> ${jsonParam(this.sql, containment)}::jsonb`
            : this.sql ``}
        ${after === '' ? this.sql `` : this.sql `AND entity_id > ${after}`}
      ORDER BY entity_id ASC
      LIMIT ${limit}
    `;
        return rows.map(function (r) {
            return rowToEntity<TAttrs>(r);
        });
    }
}
