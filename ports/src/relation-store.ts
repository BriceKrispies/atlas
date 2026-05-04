/**
 * RelationStore — typed edges between entities.
 *
 * Replaces foreign keys: instead of `variants.family_id REFERENCES families`,
 * the edge `family.variant` from `family_id` to `variant_id` lives here.
 * Adding a new edge type is metadata, not schema (the edge_type is
 * declared in the entity-type registry).
 *
 * Tenant-scoped at the primary key prefix; Invariant I7.
 *
 * For graph traversal beyond one hop, prefer querying via the declarative
 * query system (Phase C). This port intentionally exposes only the
 * single-edge primitives.
 */

export interface Relation<TAttrs = unknown> {
  tenantId: string;
  edgeType: string;
  fromId: string;
  toId: string;
  attrs: TAttrs | null;
  createdAt: string;
}

export interface RelationWriteInput<TAttrs = unknown> {
  tenantId: string;
  edgeType: string;
  fromId: string;
  toId: string;
  attrs?: TAttrs | null;
}

export interface RelationStore {
  add<TAttrs = unknown>(
    input: RelationWriteInput<TAttrs>,
  ): Promise<Relation<TAttrs>>;

  remove(
    tenantId: string,
    edgeType: string,
    fromId: string,
    toId: string,
  ): Promise<void>;

  /** Forward traversal: edges originating at `fromId`. */
  outgoing<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    fromId: string,
  ): Promise<Relation<TAttrs>[]>;

  /** Reverse traversal: edges terminating at `toId`. */
  incoming<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    toId: string,
  ): Promise<Relation<TAttrs>[]>;
}
