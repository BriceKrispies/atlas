/**
 * Typed assertion helpers for "this cannot be null" sites that need to
 * carry an invariant note instead of a `!` non-null assertion.
 *
 * - `must` — for set-then-get / length-checked-then-indexed sites where
 *   the value cannot be missing by construction. The throw is a defence
 *   against future refactors that break the invariant; in steady state
 *   it never fires.
 *
 * - `expect` — for sites where the value SHOULD be present at the call
 *   site (e.g. we just rendered the toolbar so `[data-layout-name]`
 *   must exist), but a refactor could plausibly remove it. Same
 *   runtime behaviour as `must`; the distinct name exists so the
 *   message and the reader's mental model line up.
 *
 * For genuinely-risky sites where the value really can be missing,
 * write an explicit `if (!v) ...` branch — neither helper is the
 * right shape there.
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

/**
 * Asserts that `v` is present. Use when the value's presence is part
 * of the contract at the call site (e.g. a known-shape DOM node we
 * just rendered).
 */
export function expect<T>(v: T | null | undefined, what: string): T {
  if (v == null) {
    throw new Error(`Expected ${what} to be present`);
  }
  return v;
}

/** Type-guard: narrow an `EventTarget | null` to `HTMLElement`. */
export function isHtmlElement(t: EventTarget | null | undefined): t is HTMLElement {
  return t instanceof HTMLElement;
}

/** Type-guard: narrow an `EventTarget | null` to `HTMLInputElement`. */
export function isHtmlInputElement(
  t: EventTarget | null | undefined,
): t is HTMLInputElement {
  return t instanceof HTMLInputElement;
}

/** Type-guard: narrow an `EventTarget | null` to `Element`. */
export function isElement(t: EventTarget | null | undefined): t is Element {
  return t instanceof Element;
}
