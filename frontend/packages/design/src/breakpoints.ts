/**
 * Atlas breakpoint constants.
 *
 * Authored CSS should read breakpoint values from `tokens.css`
 * (`--atlas-bp-*`). CSS custom properties can't appear in `@media`
 * conditions, so authored media queries use literal pixel values that
 * mirror these constants. JS consumers (layout signals, debug helpers)
 * import from here.
 *
 * Keep these in sync with `tokens.css` `--atlas-bp-*`.
 */

export const BREAKPOINTS = Object.freeze({
  sm: 640, // phone → small tablet
  md: 900, // tablet → laptop
  lg: 1200, // desktop
});

export type BreakpointName = keyof typeof BREAKPOINTS;

/** Returns true when the viewport is at least the named breakpoint wide. */
export function matchesBreakpoint(name: BreakpointName): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  const px = BREAKPOINTS[name];
  if (!px) return false;
  return window.matchMedia(`(min-width: ${px}px)`).matches;
}
