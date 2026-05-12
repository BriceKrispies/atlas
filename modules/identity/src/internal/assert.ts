/**
 * Typed assertion helpers for "this cannot be null" sites that need to
 * carry an invariant note instead of a `!` non-null assertion.
 *
 * Mirrors `packages/design/src/internal/assert.ts` /
 * `packages/page-templates/src/internal/assert.ts`. Duplicated here
 * rather than imported because `@atlas/identity` is a domain module
 * that must not depend on UI packages, and the helpers are tiny.
 *
 * - `must` — for set-then-get / length-checked-then-indexed sites where
 *   the value cannot be missing by construction (e.g. iterating
 *   `0..bytes.length` and reading `bytes[i]`). The throw is a defence
 *   against future refactors that break the invariant; in steady state
 *   it never fires.
 *
 * Source-only: NOT a test helper. `@atlas/test-fixtures`'s
 * `assertDefined` is for test code; this `must` carries the same shape
 * for runtime use without introducing a test-only dep on production
 * code.
 */

/**
 * Asserts that an invariant holds: `v` is not null/undefined.
 * Use for "I just set this, the next-line get cannot fail" patterns.
 */
export function must<T>(v: T | null | undefined, invariant: string): T {
  if (v == null) {
    throw new Error(`Invariant violation: ${invariant}`);
  }
  return v;
}
