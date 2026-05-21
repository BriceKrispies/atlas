/**
 * DslArtifactStore — persistence for DSL artifacts.
 *
 * Spec: `specs/decisions/0007-dsl-substrate-and-authoring-contract.md` §3
 * (storage) + §7 (versioning).
 *
 * Storage layout per ADR 0007 §3 (and revised ADR 0005 db-per-tenant):
 *   - `_atlas_dsl_<kind>`           — current row per `(tenantId, apiName)`.
 *   - `_atlas_dsl_<kind>_versions`  — append-only history of prior rows.
 *
 * Both tables live in `public` inside the tenant's database
 * (`atlas_t_<tenantUuid>`). The `_atlas_` prefix marks platform-owned tables;
 * tenant-authored ObjectType tables live alongside without the prefix.
 *
 * Tenant scoping: the adapter is constructed against a per-tenant `Sql`
 * (via `PostgresTenantDbProvider.getPool(tenantId)`). The port surface
 * does NOT take a `tenantId` parameter — the connection IS the tenant
 * boundary. `tenantId` is still stored on each row as defense-in-depth
 * per ADR 0005 §"Constraints" item 9.
 *
 * Lazy bootstrap: tables for a given kind are created on first use via
 * `ensureKindRegistered`. The migration runner does NOT preprovision
 * `_atlas_dsl_<kind>` tables because the set of kinds is open — each new
 * concrete DSL slice (expression, template, query, …) calls
 * `ensureKindRegistered(kind)` at its save handler's first write.
 *
 * Note that `DslArtifact` itself ships in `@atlas/dsl-substrate`. The port
 * imports it as a type-only dep — `@atlas/ports` does not gain a runtime
 * dependency on the substrate.
 */

import type { DslArtifact, SourceMap, ArtifactRef } from '@atlas/dsl-substrate';

/**
 * Input shape for `save`. Mirrors `DslArtifact` minus the server-minted
 * fields (`artifactId`, `version`, `createdAt`, `updatedAt`) — the adapter
 * synthesises them. `updatedBy` is set to `createdBy` on first save and
 * to the new author on subsequent saves.
 */
export interface SaveDslArtifactInput<TAst> {
  readonly kind: string;
  readonly apiName: string;
  readonly tenantId: string;
  readonly substrateVersion: string;
  readonly source: string;
  readonly ast: TAst;
  readonly sourceMap: SourceMap;
  readonly dependencies: ReadonlyArray<ArtifactRef>;
  readonly createdBy: string;
}

/**
 * Outcome shape for `save`. Carries the saved artifact (with all
 * server-minted fields populated) and a discriminator the caller can use
 * to decide whether to emit `Dsl.<Kind>.Created` vs `Dsl.<Kind>.Updated`.
 */
export interface SaveDslArtifactResult<TAst> {
  readonly artifact: DslArtifact<string, TAst>;
  /** `'inserted'` on first save of `(tenantId, kind, apiName)`; `'versioned'` on subsequent saves. */
  readonly outcome: 'inserted' | 'versioned';
}

export interface DslArtifactStore {
  /**
   * Idempotent lazy bootstrap. Creates `_atlas_dsl_<kind>` and
   * `_atlas_dsl_<kind>_versions` if they do not exist. Callers should
   * call this before the first save of a kind; the adapter MAY cache
   * "kind already bootstrapped" in memory but MUST always issue an
   * idempotent CREATE-IF-NOT-EXISTS so a fresh adapter against an
   * existing DB converges.
   *
   * `kind` MUST match `DSL_KIND_PATTERN` (from `@atlas/dsl-substrate/storage.ts`).
   * Adapters reject non-conforming kinds at the boundary so the table
   * name remains SQL-identifier-safe without quoting.
   */
  ensureKindRegistered(kind: string): Promise<void>;

  /**
   * Insert or version an artifact.
   *
   * - First save of `(tenantId, kind, apiName)`: a fresh `artifactId` is
   *   minted, `version = 1`, the row lands in `_atlas_dsl_<kind>`. No row
   *   lands in the versions table — version 1 is the current row.
   * - Subsequent saves: the current row is COPIED into
   *   `_atlas_dsl_<kind>_versions`, then UPDATED in place with `version`
   *   incremented and the new `source` / `ast` / etc. The `artifactId`
   *   is stable across versions.
   *
   * The save runs inside a single transaction so a crash mid-save leaves
   * the row at its prior version, not at a torn state.
   */
  save<TAst>(input: SaveDslArtifactInput<TAst>): Promise<SaveDslArtifactResult<TAst>>;

  /**
   * Read the latest version by `(kind, apiName)`. Returns `null` if no
   * artifact exists.
   */
  get<TAst>(kind: string, apiName: string): Promise<DslArtifact<string, TAst> | null>;

  /**
   * Read a specific historical version. Returns `null` if the version
   * doesn't exist. The latest version is found in `_atlas_dsl_<kind>`;
   * prior versions in `_atlas_dsl_<kind>_versions`. The adapter selects
   * the right table for the caller.
   */
  getVersion<TAst>(
    kind: string,
    apiName: string,
    version: number,
  ): Promise<DslArtifact<string, TAst> | null>;

  /**
   * Read by stable artifactId (latest version). Useful for tooling
   * (atlasctl dsl show <uuid>) and for audit traces that captured the
   * artifactId at emission.
   */
  getById<TAst>(kind: string, artifactId: string): Promise<DslArtifact<string, TAst> | null>;

  /**
   * List latest versions for every artifact of a kind in this tenant.
   * Used by the `GET /api/v1/dsl/<kind>` endpoint (ADR 0007 §8) and by
   * `atlasctl dsl <kind> list`.
   */
  list<TAst>(kind: string): Promise<ReadonlyArray<DslArtifact<string, TAst>>>;
}
