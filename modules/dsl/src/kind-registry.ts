/**
 * Generic registry of DSL kinds (expression, template, query, …).
 *
 * The handler in this module is uniform across kinds: it looks up the
 * supplied `kind` string in the registry, runs that kind's parser +
 * static checker, and (on success) saves the artifact via the
 * `DslArtifactStore` port. The kind descriptor carries the per-kind
 * specifics — grammar, AST shape, host-op set — without leaking them
 * into the handler control flow.
 *
 * Liskov: each `DslKind` ships its own `TAst`, `TScope`, `TOutput`, and
 * `TOps`, but they all conform to the same `AnyDslKind` shape at the
 * registry boundary. Substitution holds — replacing the expression DSL
 * with a future template DSL is a registry registration, not a handler
 * change.
 */

import type {
  DslError,
  DslEvaluator,
  HostOpRegistry,
  HostOpSet,
  Result,
  SourceMap,
} from '@atlas/dsl-substrate';

/**
 * Per-kind descriptor. Carries everything the handler / queries need
 * to process artifacts of this kind.
 */
export interface DslKind<TAst, TScope, TOutput, TOps extends HostOpSet> {
  readonly kind: string;
  /**
   * Parse source text into `(ast, sourceMap)`. Returns a substrate-shaped
   * `Result` — no throws. Each DSL author ships its own parser; this
   * field abstracts over them at the registry boundary.
   */
  parse(source: string): Result<{ ast: TAst; sourceMap: SourceMap }, DslError>;
  /**
   * The kind's evaluator. The handler uses `staticCheck` (during save +
   * validate endpoints); other consumers can run `evaluate` against a
   * loaded artifact.
   */
  readonly evaluator: DslEvaluator<TAst, TScope, TOutput, TOps>;
  /**
   * The kind's closed host-op set. Exposed for introspection (list ops
   * available to this kind) and for downstream consumers that call
   * `evaluate`.
   */
  readonly registry: HostOpRegistry<TOps>;
}

/**
 * Type-erased view used by the handler. Per ADR 0007 §9 — different
 * DSLs have different ASTs; the kind-erased shape is the structural
 * point of substitution.
 */
export type AnyDslKind = DslKind<unknown, unknown, unknown, HostOpSet>;

export interface DslKindRegistry {
  has(kind: string): boolean;
  get(kind: string): AnyDslKind | undefined;
  list(): ReadonlyArray<string>;
}

/**
 * Build an immutable registry over the supplied kind descriptors. Order
 * of `list()` matches construction order.
 */
export function makeDslKindRegistry(kinds: ReadonlyArray<AnyDslKind>): DslKindRegistry {
  const byName = new Map<string, AnyDslKind>();
  for (const k of kinds) {
    if (byName.has(k.kind)) {
      throw new Error(`makeDslKindRegistry: duplicate kind '${k.kind}'`);
    }
    byName.set(k.kind, k);
  }
  const ordered = kinds.map((k) => k.kind);
  return {
    has(kind: string): boolean {
      return byName.has(kind);
    },
    get(kind: string): AnyDslKind | undefined {
      return byName.get(kind);
    },
    list(): ReadonlyArray<string> {
      return ordered;
    },
  };
}
