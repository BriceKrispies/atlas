/**
 * Typed narrowing helpers for design internals. Pure type-guards plus
 * `must` for "I just set this, the get cannot fail" patterns — keeps the
 * call site free of `!` non-null assertions and `as Type` casts.
 *
 * Mirrors `packages/widgets/src/internal/assert.ts` /
 * `packages/page-templates/src/internal/assert.ts`. Duplicated here
 * rather than imported because `@atlas/design` must not depend on either
 * of those packages — they already depend on `@atlas/design`.
 */

/** Asserts that `v` is not null/undefined; throws if the invariant is broken. */
export function must<T>(v: T | null | undefined, invariant: string): T {
  if (v == null) {
    throw new Error(`Invariant violation: ${invariant}`);
  }
  return v;
}

/** Type-guard: narrow an `EventTarget | null` to `Element`. */
export function isElement(t: EventTarget | null | undefined): t is Element {
  return t instanceof Element;
}

/** Type-guard: narrow an `EventTarget | null` to `HTMLElement`. */
export function isHtmlElement(t: EventTarget | null | undefined): t is HTMLElement {
  return t instanceof HTMLElement;
}

/** Type-guard: narrow to `HTMLInputElement`. */
export function isHtmlInputElement(
  t: EventTarget | Node | null | undefined,
): t is HTMLInputElement {
  return t instanceof HTMLInputElement;
}

/**
 * Read a `string` from an arbitrary Event whose `detail` is shaped
 * `{ value: string }`. Returns `undefined` when the event is not a
 * CustomEvent or the detail/value is missing/non-string. Used at the
 * boundary where a custom child element fires a typed `CustomEvent` but
 * the listener signature is bound to `Event`.
 */
export function readDetailValue(ev: Event): string | undefined {
  if (!(ev instanceof CustomEvent)) return undefined;
  const detail: unknown = ev.detail;
  if (detail === null || typeof detail !== 'object') return undefined;
  const v: unknown = (detail as { value?: unknown }).value;
  return typeof v === 'string' ? v : undefined;
}
