/**
 * `Dsl.<Kind>.Update` intent envelope shape.
 *
 * ADR 0007 §8 fixes the authoring contract: every DSL exposes the same
 * authoring shape across write / read / validate / atlasctl. The wire
 * payload for the WRITE side is the same across every DSL kind — only
 * `kind` and the body's interpretation differ. This file ships the shared
 * envelope; per-DSL slices add the typed payload union later.
 *
 * The intent flows through the ingress pipeline (I1, I2, I3, I5, I13) like
 * every other intent. The substrate does not add a side-door write path —
 * a `Dsl.Expression.Update` becomes an envelope inside the existing
 * `POST /api/v1/intents` route once the expression DSL slice (#3) lands
 * its handler.
 */

/**
 * The wire payload for `Dsl.<Kind>.Update`. Per ADR 0007 §8:
 *   `Intent { action: 'Dsl.<Kind>.Update', payload: { apiName, source } }`
 *
 * The platform parses `source` server-side; the AST is a projection, never
 * accepted as input authority (ADR 0007 §4). Submitting only the source
 * keeps the wire contract small and forces the server to do canonicalisation.
 */
export interface DslUpdatePayload {
  /** Tenant-unique within `(tenantId, kind)`. */
  readonly apiName: string;
  /** Canonical source text. The server parses → produces AST. */
  readonly source: string;
}

/**
 * Helper for building the action string. Used by atlasctl and the
 * per-DSL handlers to compose `Dsl.Expression.Update` etc. without
 * stringly-typing the namespace at each call site.
 *
 * Returns `'Dsl.${capitalised-kind}.Update'`. Kinds are lower-snake
 * in storage (`expression`, `template`, `query`) but the action namespace
 * uses TitleCase per Atlas's existing event-name convention
 * (see `specs/crosscut/events.md` if it lands; currently following the
 * convention used in `Catalog.Family.Publish` and similar handlers).
 */
export function dslUpdateAction(kind: string): string {
  if (kind.length === 0) {
    return 'Dsl..Update';
  }
  const head = kind[0] ?? '';
  const titleCased = `${head.toUpperCase()}${kind.slice(1)}`;
  return `Dsl.${titleCased}.Update`;
}
