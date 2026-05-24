/**
 * DSL artifact envelope shapes — the Liskov base envelope for every DSL
 * artifact in Atlas (ADR 0007 §9). These are pure ABI types (Ring 0): the
 * wire / storage / audit / lifecycle shape every DSL artifact substitutes
 * into. They live here, not in `@atlas/dsl-substrate`, so that `@atlas/ports`
 * (Ring 1) can reference them without depending on the runtime substrate
 * (Ring 2). `@atlas/dsl-substrate` re-exports them and owns the runtime
 * companions (`isKind`, table helpers). See ADR 0016.
 *
 * This file does NOT introduce a shared AST — different DSLs differ in `TAst`.
 * It is the shared *envelope* only.
 */

/**
 * A source-text range. Lines and columns are 1-based to match every
 * compiler / language-server convention an agent might already speak.
 */
export interface SourceRange {
  readonly startLine: number;
  readonly startCol: number;
  readonly endLine: number;
  readonly endCol: number;
}

/**
 * AST-node → SourceRange mapping. Required for every parsed artifact so
 * the `validate` endpoint can surface errors keyed to source. ADR 0007 §8:
 * "an error without a source range is invisible to an agent trying to fix it."
 *
 * `nodeId` is the value of the `id` field on the corresponding AST node.
 * Each DSL defines its own AST shape, but every AST node MUST carry a
 * stable `id` string to participate in this map.
 */
export type SourceMap = ReadonlyArray<{
  readonly nodeId: string;
  readonly range: SourceRange;
}>;

/**
 * A reference to another DSL artifact. Cross-DSL references resolve at
 * evaluation time (ADR 0007 §7) — a template that uses a query reads the
 * current version of the referenced artifact when it runs. Pinning is
 * supported for audit replay, A/B tests, and snapshot diffs.
 */
export interface ArtifactRef {
  readonly kind: string;
  readonly apiName: string;
  /** Pin to a specific version. Omit to resolve "latest" at evaluation time. */
  readonly pinnedVersion?: number;
}

/**
 * The shared envelope. `TKind` is a string-literal narrowing of the artifact's
 * kind (e.g. `'expression' | 'template' | 'query'`); `TAst` is the kind's
 * own AST type. Consumers that don't care about the AST work at
 * `DslArtifact<string, unknown>`; consumers that do narrow via the `kind`
 * discriminant.
 *
 * Storage: per ADR 0005 (db-per-tenant) and ADR 0007 §3, every artifact lives
 * in `atlas_t_<tenantUuid>.public._atlas_dsl_<kind>`. The columns map 1:1 to
 * the readonly fields below; see `@atlas/dsl-substrate` ▸ `storage.ts` for
 * table conventions.
 */
export interface DslArtifact<TKind extends string, TAst> {
  /** Discriminator. Narrowing via this field reveals `TAst`. */
  readonly kind: TKind;
  /** Server-minted UUID. Stable for the artifact's lifetime. */
  readonly artifactId: string;
  /**
   * Tenant-unique identifier within `(tenantId, kind)`. Authored by the
   * tenant; used as the lookup key in templates / queries that reference
   * each other.
   */
  readonly apiName: string;
  readonly tenantId: string;
  /** Monotonic per `artifactId`. Increments on every `Dsl.<Kind>.Update`. */
  readonly version: number;
  /**
   * Semver of the `@atlas/dsl-substrate` package at the time the artifact
   * was saved. Pinned by the author; the evaluator rejects mismatches.
   */
  readonly substrateVersion: string;
  /** Canonical text. The field tenants edit; what diffs render. */
  readonly source: string;
  /** Parser projection over `source`. Must equal `parse(source)` per ADR 0007 §4. */
  readonly ast: TAst;
  readonly sourceMap: SourceMap;
  /** Cross-DSL references resolved at evaluation time (ADR 0007 §7). */
  readonly dependencies: ReadonlyArray<ArtifactRef>;
  /** ISO-8601 timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Principal IDs. Audit trail per ADR 0007 §"Constraints" item 8 (atlasctl parity). */
  readonly createdBy: string;
  readonly updatedBy: string;
}
