/**
 * Discriminated-union success/failure type. Used everywhere in the DSL
 * substrate so the evaluator's "purity by signature" guarantee holds:
 * failure modes live in the value, not in thrown exceptions that cross
 * await boundaries and stack frames.
 *
 * Why a standalone file: `Result` is referenced by `./evaluator.ts`,
 * `./host-ops.ts`, `./budget.ts`, `./errors.ts`, and `./contract-tests.ts`.
 * Living in the evaluator file would create a circular dependency between
 * evaluator and host-ops (the evaluator imports `HostOpSet`; the host-op
 * `invoke` returns `Result`). Hoisting to its own leaf module keeps the
 * dependency graph acyclic — verified by `pnpm deps:check`.
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
