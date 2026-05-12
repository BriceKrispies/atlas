/**
 * Typed narrowing helpers for sandbox internals. Pure type-guards plus
 * `must` for "I just set this, the get cannot fail" patterns — keeps the
 * call site free of `!` non-null assertions and `as Type` casts.
 *
 * Mirrors `packages/widgets/src/internal/assert.ts` /
 * `packages/design/src/internal/assert.ts`. Duplicated here rather than
 * imported because `apps/sandbox` depends on neither for runtime code
 * (only types from `@atlas/design`).
 */

/** Asserts that `v` is not null/undefined; throws if the invariant is broken. */
export function must<T>(v: T | null | undefined, invariant: string): T {
  if (v == null) {
    throw new Error(`Invariant violation: ${invariant}`);
  }
  return v;
}

/** Type-guard: narrow an `EventTarget | null` to `Element`. */
export function isElement(t: EventTarget | Node | null | undefined): t is Element {
  return t instanceof Element;
}

/** Type-guard: narrow an `EventTarget | null` to `HTMLElement`. */
export function isHtmlElement(t: EventTarget | Node | null | undefined): t is HTMLElement {
  return t instanceof HTMLElement;
}

/**
 * Read `event.detail` as a typed value WITHOUT introducing a narrowing cast.
 * The supplied validator runs first; if it returns false the helper throws,
 * surfacing the contract mismatch rather than letting bad data flow.
 *
 * Use this when a CustomEvent crosses a boundary (DOM dispatch) and we need
 * a typed handle to its detail at the call site.
 */
export function customDetail<T>(
  ev: Event,
  validate: (d: unknown) => d is T,
  what: string,
): T {
  if (!(ev instanceof CustomEvent)) {
    throw new Error(`${what}: expected CustomEvent, got ${ev.constructor.name}`);
  }
  const detail: unknown = ev.detail;
  if (!validate(detail)) {
    throw new Error(`${what}: detail shape mismatch`);
  }
  return detail;
}

/** Validator: `{ value: string }`. */
export function isValueDetail(d: unknown): d is { value: string } {
  return typeof d === 'object' && d !== null && typeof (d as { value?: unknown }).value === 'string';
}

/** Validator: `{ id: string }`. */
export function isIdDetail(d: unknown): d is { id: string } {
  return typeof d === 'object' && d !== null && typeof (d as { id?: unknown }).id === 'string';
}

/**
 * Parse a widget mount-config (`Record<string, unknown>`) into a typed
 * shape by reading known fields with optional type checks. Returns a fresh
 * object so the caller can safely treat it as the typed config.
 *
 * Unlike a structural cast, this performs runtime validation of every
 * field it reads — fields that don't match their expected type fall back
 * to `undefined` so the caller's `?? default` fallback applies.
 */
export function parseMountConfig<T>(
  raw: Record<string, unknown>,
  shape: { [K in keyof T]-?: (v: unknown) => v is NonNullable<T[K]> },
): Partial<T> {
  // Build the result object typed as `Partial<T>` so each validated
  // field is assigned through a typed setter — no `as T` cast required.
  // Callers should declare T with all-optional fields (the natural
  // shape of a mount config) so `Partial<T>` is structurally
  // assignable everywhere T is expected.
  const out: Partial<T> = {};
  // `shape` is keyed by `keyof T`, but `Object.keys` widens to string[].
  // Iterate the raw keys, look them up in shape (which returns
  // `undefined` for keys we don't track), and feed the validator only
  // when we have one. No structural cast required.
  for (const key in shape) {
    const check = shape[key];
    if (typeof check !== 'function') continue;
    const value = raw[key];
    if (value !== undefined && check(value)) {
      out[key] = value;
    }
  }
  return out;
}

/** Validators for primitive shapes used by widget mount configs. */
export const v = {
  string: (x: unknown): x is string => typeof x === 'string',
  number: (x: unknown): x is number => typeof x === 'number',
  boolean: (x: unknown): x is boolean => typeof x === 'boolean',
  /**
   * Accept any non-null/undefined value. Matches `NonNullable<unknown>`,
   * which TS reduces to the empty-object type — use this when the
   * underlying mount-config field is `unknown` and the widget owns its
   * own runtime validation downstream.
   */
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: matches NonNullable<unknown> exactly
  defined: (x: unknown): x is {} => x !== null && x !== undefined,
  array: (x: unknown): x is unknown[] => Array.isArray(x),
};
