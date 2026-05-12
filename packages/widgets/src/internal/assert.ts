/**
 * Typed narrowing helpers for widget internals. Pure type-guards plus
 * `must` for "I just set this, the get cannot fail" patterns — keeps the
 * call site free of `!` non-null assertions and `as Type` casts.
 *
 * Mirrors `packages/page-templates/src/internal/assert.ts`. Duplicated
 * here rather than imported because `@atlas/widgets` must not depend on
 * `@atlas/page-templates` (page-templates already depends on widgets).
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
