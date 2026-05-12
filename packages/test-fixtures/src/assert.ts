/**
 * Narrows `v` to `T`, throwing if undefined or null. Use in tests
 * where set-then-get or post-length-check guarantees existence —
 * replaces `someMap.get(k)!` patterns with an explicit invariant
 * check whose message tells the next reader why the lookup can't fail.
 */
export function assertDefined<T>(v: T | null | undefined, msg: string): T {
  if (v == null) throw new Error(`Test invariant violation: ${msg}`);
  return v;
}
