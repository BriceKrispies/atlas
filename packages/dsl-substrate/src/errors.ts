/**
 * Error shape for the DSL substrate.
 *
 * ADR 0007 §8: "errors include `{ code, message, sourceRange, suggestion? }`.
 * This is non-negotiable: an error without a source range is invisible to an
 * agent trying to fix it." That clause shapes everything in this file —
 * every parse / static-check / type / unknown-identifier error carries a
 * `sourceRange`. Only `DSL_HOST_OP_FAILED` may omit one (the failure happens
 * inside the host op, not at a static source position), and even then we
 * attach the call site's range as a best effort.
 *
 * The substrate NEVER throws. Evaluator results are `Result<T, DslError>`
 * (see `./evaluator.ts`); host ops return `Result<TOut, HostOpError>` (see
 * `./host-ops.ts`). The only way to surface a DSL failure to a caller is to
 * return one of these shapes. This keeps the substrate side-effect-free in
 * its failure modes too — a thrown exception would couple the caller's
 * control flow to whatever stack frame the throw happened in.
 */

import type { SourceRange } from './artifact.ts';

/**
 * Closed taxonomy of substrate error codes. Each DSL kind MAY narrow this
 * further at its capability spec (e.g. the expression DSL adds
 * `DSL_DIVISION_BY_ZERO`), but every DSL's evaluator returns a
 * `DslError` whose `code` is in this set or a documented kind-local
 * extension. Cross-DSL consumers (the validate endpoint, atlasctl, the
 * audit emitter) only need to know this base set.
 */
export type DslErrorCode =
  | 'DSL_PARSE_ERROR'
  | 'DSL_TYPE_ERROR'
  | 'DSL_UNKNOWN_IDENTIFIER'
  | 'DSL_BUDGET_EXCEEDED'
  | 'DSL_HOST_OP_FAILED'
  | 'DSL_BROKEN_REFERENCE'
  | 'DSL_SUBSTRATE_VERSION_MISMATCH';

/**
 * Host-op failure shape. Effectful host ops route through a named port
 * (see `./host-ops.ts`); when the port's operation fails (DB error,
 * function-runtime fault, etc.), the host op returns this shape. The
 * evaluator wraps it as a `DslError` with `code: 'DSL_HOST_OP_FAILED'`
 * and the host-op call site's `sourceRange`.
 */
export interface HostOpError {
  /** The host op that failed (e.g. `'lookup'`, `'function'`). */
  readonly opName: string;
  /** Free-form reason from the port. */
  readonly reason: string;
  /** Underlying cause if the port surfaced one. */
  readonly cause?: unknown;
}

/**
 * The single error shape every DSL emits. `cause` is `unknown` rather than
 * a recursive `DslError` because host ops fail with their own shape; the
 * evaluator may also nest a substrate error inside another (e.g. a parser
 * error caused by a budget exhaustion during deep nesting).
 */
export interface DslError {
  readonly code: DslErrorCode;
  readonly message: string;
  /** Required for every static error; best-effort for runtime / host-op failures. */
  readonly sourceRange?: SourceRange;
  /** Author-facing remediation. Optional but encouraged — agents fix faster with it. */
  readonly suggestion?: string;
  /** Wrapped cause (another `DslError`, a `HostOpError`, or any underlying value). */
  readonly cause?: unknown;
}
