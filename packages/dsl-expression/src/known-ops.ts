/**
 * Single source of truth for the expression DSL's host-op names.
 *
 * Listed here (rather than derived from `host-ops.ts`) so the static
 * checker can reference the set without pulling the heavy host-ops
 * module into the validate path. The two MUST stay in lockstep — a
 * conformance test asserts equality between the registry's keys and
 * this set.
 */
export const KNOWN_OP_NAMES: ReadonlySet<string> = new Set([
  'upper',
  'lower',
  'trim',
  'len',
  'escape',
  'coalesce',
  'now',
  'format',
]);
