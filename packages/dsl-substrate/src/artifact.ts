/**
 * The Liskov base envelope for every DSL artifact in Atlas.
 *
 * The envelope SHAPES (`SourceRange`, `SourceMap`, `ArtifactRef`,
 * `DslArtifact`) moved to `@atlas/abi` (Ring 0) per ADR 0016 so that
 * `@atlas/ports` can reference them without depending on this runtime
 * substrate. They are re-exported here unchanged, so every existing
 * `@atlas/dsl-substrate` consumer keeps importing them from this package.
 * The runtime companion (`isKind`) stays here.
 *
 * ADR 0007 §9 explicitly forbids a shared AST across DSL kinds — this file
 * does NOT introduce a shared AST. It re-exports a shared *envelope* only.
 */

import type { DslArtifact } from '@atlas/abi';

export type { SourceRange, SourceMap, ArtifactRef, DslArtifact } from '@atlas/abi';

/**
 * Type-guard companion for `kind` narrowing. Lets a consumer that only has
 * `DslArtifact<string, unknown>` recover the typed view for a known kind.
 *
 * ```ts
 * if (isKind(artifact, 'expression')) {
 *   // artifact is now DslArtifact<'expression', ExprAst>
 *   evaluator.evaluate(artifact.ast, scope, ops, budget);
 * }
 * ```
 */
export function isKind<TKind extends string, TAst>(
  artifact: DslArtifact<string, unknown>,
  kind: TKind,
): artifact is DslArtifact<TKind, TAst> {
  return artifact.kind === kind;
}
