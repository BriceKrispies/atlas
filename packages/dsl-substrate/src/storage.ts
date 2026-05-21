/**
 * Storage-shape conventions for DSL artifacts. Per ADR 0007 §3 and the
 * revised ADR 0005 (db-per-tenant), every DSL artifact lives in:
 *
 *   `atlas_t_<tenantUuid>.public._atlas_dsl_<kind>`
 *
 * with a sibling history table:
 *
 *   `atlas_t_<tenantUuid>.public._atlas_dsl_<kind>_versions`
 *
 * Storage is lazy-bootstrapped on first artifact of a given kind, mirroring
 * the `_atlas_object_types` lazy-bootstrap pattern from
 * `custom-schema/object-definition`.
 *
 * This file ships the *naming* conventions and a small helper to compute
 * the table name from a kind. The actual SQL migration to create the table
 * lands with the first concrete DSL slice (slice #2 / #3, per the plan)
 * because that's when the first kind needs persistence. The `DslArtifactStore`
 * port that wraps these tables is also deferred.
 *
 * Why ship this file in slice #1 anyway: the per-DSL slices need the
 * naming function and the prefix constant to write their migration and
 * adapter. Centralising here keeps the convention in one place.
 */

/**
 * Prefix for every DSL artifact table. The `_atlas_` prefix marks
 * platform-owned tables inside the tenant's `public` schema (per ADR 0005
 * §"Out of scope" sub-schema discussion: "everything in `public`, with the
 * `_atlas_` prefix on platform-owned tables").
 */
export const DSL_TABLE_PREFIX = '_atlas_dsl_';

/**
 * Suffix appended to the artifact table name to derive the version-history
 * table. ADR 0007 §3: "Each kind also lazy-bootstraps a sibling
 * `_atlas_dsl_<kind>_versions` history table for prior-version recovery."
 */
export const DSL_VERSIONS_TABLE_SUFFIX = '_versions';

/**
 * A kind name is the lowercase identifier used in `_atlas_dsl_<kind>`. The
 * substrate restricts kinds to a narrow charset so the table name is
 * SQL-identifier-safe without quoting. The first DSL slice will assert
 * this regex on `kind` registration.
 */
export const DSL_KIND_PATTERN = /^[a-z][a-z0-9_]{1,30}$/;

/**
 * Return `'_atlas_dsl_<kind>'` for a kind. Caller is responsible for
 * pre-validating `kind` against `DSL_KIND_PATTERN` — the per-DSL handler
 * does this at registration time, the table-builder does it at migration
 * time. Belt-and-braces.
 */
export function dslTableName(kind: string): string {
  return `${DSL_TABLE_PREFIX}${kind}`;
}

/**
 * Return `'_atlas_dsl_<kind>_versions'` for a kind. Same caller contract
 * as `dslTableName`.
 */
export function dslVersionsTableName(kind: string): string {
  return `${DSL_TABLE_PREFIX}${kind}${DSL_VERSIONS_TABLE_SUFFIX}`;
}

/**
 * The platform schema fields every `_atlas_dsl_<kind>` table carries. The
 * concrete adapter migration translates this to SQL DDL. Listed as a TS
 * constant so per-DSL slices can introspect at compile time.
 *
 * Column-name conventions: snake_case per Postgres convention; matches the
 * `DslArtifact` envelope fields 1:1 except for case.
 */
export const DSL_ARTIFACT_COLUMNS = [
  'artifact_id',
  'api_name',
  'tenant_id',
  'version',
  'substrate_version',
  'source',
  'ast',
  'source_map',
  'dependencies',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
] as const;

export type DslArtifactColumn = (typeof DSL_ARTIFACT_COLUMNS)[number];
