/**
 * EntityStore — generic JSONB entity substrate.
 *
 * Every domain entity (Page, Family, Variant, Badge, Token, …) is a row
 * keyed by `(tenantId, entityType, entityId)` with a `attrs: unknown`
 * payload. The shape of `attrs` is governed by the entity type's
 * registered schema (see `EntityTypeRegistry`). The L3 plan in
 * `~/.claude/plans/yes-mossy-galaxy.md` walks through the role this
 * port plays.
 *
 * Implementations live in `@atlas/adapter-node` (Postgres) and
 * eventually `@atlas/adapter-idb` (sim parity, when a sim consumer exists).
 *
 * Tenancy is enforced at the (`tenantId`, …) prefix of every key — there
 * is no cross-tenant escape hatch. (Invariant I7.)
 *
 * Reads pass through the `Upcaster` pipeline (see
 * `@atlas/platform-core/upcaster`) so callers always observe the
 * latest schema version regardless of what's on disk. Writes always
 * record at the latest version.
 */

export type EntityStatus = 'active' | 'archived' | 'deleted';

export interface Entity<TAttrs = unknown> {
  tenantId: string;
  entityType: string;
  entityId: string;
  schemaVersion: number;
  attrs: TAttrs;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EntityWriteInput<TAttrs = unknown> {
  tenantId: string;
  entityType: string;
  entityId: string;
  attrs: TAttrs;
  status?: EntityStatus;
  /**
   * Schema version the *caller* is writing at. Defaults to the latest
   * registered version. Tests / migration scripts may pin this to write
   * legacy versions on purpose.
   */
  schemaVersion?: number;
}

export interface EntityListOptions {
  /** Default `'active'`. Pass `null` to include any status. */
  status?: EntityStatus | null;
  limit?: number;
  /** Cursor: the `entityId` of the last row returned. */
  after?: string;
}

export interface EntityQueryOptions extends EntityListOptions {
  /**
   * Equality predicates over JSONB attrs paths. Composed with AND.
   * Example: `{ "familyKey": "shoes", "revisionNumber": 1 }`.
   *
   * For richer query shapes (range, OR, joins) see Phase C's declarative
   * query system; this method intentionally stays small.
   */
  attrsEqual?: Record<string, unknown>;
}

export interface EntityStore {
  get<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<Entity<TAttrs> | null>;

  put<TAttrs = unknown>(
    input: EntityWriteInput<TAttrs>,
  ): Promise<Entity<TAttrs>>;

  /**
   * Soft-delete: marks status as 'deleted' rather than removing the row.
   * Hard delete is reserved for compliance flows (right-to-be-forgotten)
   * and goes through a separate operator path.
   */
  delete(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<void>;

  list<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts?: EntityListOptions,
  ): Promise<Entity<TAttrs>[]>;

  query<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts: EntityQueryOptions,
  ): Promise<Entity<TAttrs>[]>;
}
