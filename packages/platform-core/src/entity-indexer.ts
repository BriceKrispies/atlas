/**
 * Index materializer.
 *
 * Reconciles the *declared* set of `entities` expression indexes
 * (from `control_plane.index_registry`) against the *live* set in the
 * tenant DB. Emits CREATE / DROP statements for the diff. The runtime
 * wiring layer executes them; this module is a pure function so the
 * reconciliation logic can be unit-tested without a database.
 *
 * One Postgres index per declared row. Index name format:
 *   entities_<entity_type>_<index_name>_idx
 *
 * Naming is deterministic so the live-set query can attribute each index
 * back to a registry row.
 *
 * See `~/.claude/plans/yes-mossy-galaxy.md` for the L3 plan.
 */

import type { IndexDeclarationRow } from './control-plane-db.ts';

/** Postgres index name we materialize for a given declaration. */
export function indexNameFor(decl: {
  entity_type: string;
  index_name: string;
}): string {
  return `entities_${decl.entity_type}_${decl.index_name}_idx`;
}

/**
 * Render a JSON path (`familyKey`, `metadata.priority`) to a Postgres
 * expression that extracts the text value from `attrs`. Nested paths
 * use the `->` chain plus a final `->>` for text coercion.
 */
export function jsonbPathExpr(path: string): string {
  const parts = path.split('.').filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error(`invalid empty index path`);
  }
  if (parts.length === 1) {
    // attrs->>'familyKey'
    return `(attrs->>${quoteLiteral(parts[0]!)})`;
  }
  // attrs->'metadata'->>'priority'
  const head = parts.slice(0, -1).map((p) => `->${quoteLiteral(p)}`).join('');
  const tail = `->>${quoteLiteral(parts[parts.length - 1]!)}`;
  return `(attrs${head}${tail})`;
}

function quoteLiteral(s: string): string {
  // Identifiers used inside JSONB path expressions are SQL string
  // literals, not identifiers — escape single quotes. Path keys come
  // from the declared registry rows, but we still defend against `'`
  // characters in case a tenant adds a custom field with one.
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Render a CREATE INDEX statement for a declaration. We use
 * `CREATE INDEX IF NOT EXISTS` so a partial reconcile (where some
 * declared indexes already exist) is idempotent.
 *
 * WHERE clauses come from `decl.where_clause` as a JSONB containment
 * predicate (`attrs @> '{...}'::jsonb`). Anything richer requires
 * Phase C's query DSL.
 */
export function createIndexSql(decl: IndexDeclarationRow): string {
  const name = indexNameFor(decl);
  const exprs = decl.field_paths.map((p) => jsonbPathExpr(p)).join(', ');
  const unique = decl.is_unique ? 'UNIQUE ' : '';
  // Always carry tenant_id + entity_type as leading columns on every
  // expression index so they cover the per-tenant scope automatically.
  // This means a declared index on `familyKey` materializes as
  // (tenant_id, entity_type, attrs->>'familyKey').
  let stmt = `CREATE ${unique}INDEX IF NOT EXISTS ${name} ON entities (tenant_id, entity_type, ${exprs})`;
  if (decl.where_clause && typeof decl.where_clause === 'object') {
    stmt += ` WHERE attrs @> '${JSON.stringify(decl.where_clause).replace(/'/g, "''")}'::jsonb`;
  }
  return stmt;
}

export function dropIndexSql(indexName: string): string {
  return `DROP INDEX IF EXISTS ${indexName}`;
}

/**
 * Compare declared vs live and produce the SQL needed to reconcile.
 * Pure function — no I/O. The runtime wiring layer fetches
 * `liveIndexNames` (e.g. via `pg_indexes`) and executes the resulting
 * statements.
 *
 * `liveIndexNames` should be the names of indexes on the `entities`
 * table that match the materializer's `entities_*_idx` naming scheme;
 * indexes outside that namespace are ignored (the baseline indexes
 * from the migration are not managed by the materializer).
 */
export function reconcile(
  declared: IndexDeclarationRow[],
  liveIndexNames: ReadonlySet<string>,
): { create: string[]; drop: string[] } {
  const declaredNames = new Set(declared.map(indexNameFor));
  const create: string[] = [];
  const drop: string[] = [];

  for (const decl of declared) {
    if (!liveIndexNames.has(indexNameFor(decl))) {
      create.push(createIndexSql(decl));
    }
  }
  for (const live of liveIndexNames) {
    // Only drop indexes that look materializer-managed AND aren't in
    // the declared set. This avoids accidentally dropping the baseline
    // `entities_tenant_type_status_idx` or any human-added index.
    if (!live.startsWith('entities_') || !live.endsWith('_idx')) continue;
    if (live === 'entities_tenant_type_status_idx') continue;
    if (live === 'entities_attrs_gin_idx') continue;
    if (!declaredNames.has(live)) {
      drop.push(dropIndexSql(live));
    }
  }

  return { create, drop };
}
