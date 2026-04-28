/**
 * Atlas icon registry.
 *
 * Central catalogue of inline SVG path data used by `<atlas-icon>`. Each
 * entry declares a `viewBox` plus the inner `paths` markup (`<path>`,
 * `<line>`, `<polyline>`, `<circle>`, …). `<atlas-icon>` renders these into
 * a `<svg>` element with `fill`/`stroke` defaulted to `currentColor`, so the
 * icon inherits the surrounding text colour.
 *
 * Path data was copied verbatim from the inline SVGs scattered across the
 * design-system components prior to this consolidation — the migration is
 * intentionally a visual no-op.
 */
export interface AtlasIconEntry {
  /** SVG `viewBox` attribute, e.g. `"0 0 16 16"`. */
  readonly viewBox: string;
  /** SVG inner markup (paths, lines, polylines, circles). */
  readonly paths: string;
  /** Default stroke width applied when the icon uses stroke styling. */
  readonly strokeWidth?: string;
  /** Default stroke-linecap. */
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
  /** Default stroke-linejoin. */
  readonly strokeLinejoin?: 'miter' | 'round' | 'bevel';
  /** If true, the icon paints with `fill="currentColor"` instead of stroke. */
  readonly filled?: boolean;
}

const _registry = new Map<string, AtlasIconEntry>();

/**
 * Register (or override) an icon entry. Later calls for the same `name`
 * replace the existing entry.
 */
export function registerIcon(name: string, entry: AtlasIconEntry): void {
  _registry.set(name, entry);
}

/**
 * Look up an icon entry by name. Returns `undefined` for unknown names.
 */
export function getIcon(name: string): AtlasIconEntry | undefined {
  return _registry.get(name);
}

/** All registered icon names (for tests / tooling). */
export function iconNames(): readonly string[] {
  return Array.from(_registry.keys());
}

// ── Built-in icons ──────────────────────────────────────────────────────
//
// Every path below was copied verbatim from the corresponding inline SVG in
// the design-system components. Do not redraw without checking the
// migration remains visually identical.

// Down caret used by atlas-multi-select trigger.
registerIcon('chevron-down', {
  viewBox: '0 0 16 16',
  paths: '<path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/>',
  strokeWidth: '2',
});

// Narrower down caret used by atlas-select (native-select adornment).
registerIcon('caret-down', {
  viewBox: '0 0 12 8',
  paths: '<polyline points="1,1.5 6,6.5 11,1.5"/>',
  strokeWidth: '1.8',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

// Checkmark used by atlas-checkbox (tick) and atlas-multi-select (option-selected).
registerIcon('check', {
  viewBox: '0 0 16 16',
  paths: '<polyline points="3,8 7,12 13,4"/>',
  strokeWidth: '2.5',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

// Alternate checkmark used by atlas-multi-select option (different path shape).
registerIcon('check-path', {
  viewBox: '0 0 16 16',
  paths: '<path d="M3 8.5l3.5 3.5L13 5" stroke-linecap="round" stroke-linejoin="round"/>',
  strokeWidth: '2',
});

// Dash / indeterminate bar for atlas-checkbox.
registerIcon('dash', {
  viewBox: '0 0 16 16',
  paths: '<line x1="3" y1="8" x2="13" y2="8"/>',
  strokeWidth: '2.5',
  strokeLinecap: 'round',
});

// Magnifier used by atlas-search-input.
registerIcon('search', {
  viewBox: '0 0 20 20',
  paths: '<circle cx="9" cy="9" r="6"/><line x1="14" y1="14" x2="18" y2="18"/>',
  strokeWidth: '1.8',
  strokeLinecap: 'round',
});

// Close / X used by atlas-search-input clear button (20×20).
registerIcon('x', {
  viewBox: '0 0 20 20',
  paths: '<line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/>',
  strokeWidth: '2',
  strokeLinecap: 'round',
});

// Close / X (16×16) used by atlas-file-upload remove-file button.
registerIcon('x-sm', {
  viewBox: '0 0 16 16',
  paths: '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>',
  strokeWidth: '2',
  strokeLinecap: 'round',
});

// Upload arrow + tray used by atlas-file-upload drop-zone.
registerIcon('upload', {
  viewBox: '0 0 24 24',
  paths:
    '<path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  strokeWidth: '1.8',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

// Hamburger / menu toggle used by shell headers.
registerIcon('menu', {
  viewBox: '0 0 24 24',
  paths:
    '<line x1="4" y1="7"  x2="20" y2="7"  /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />',
  strokeWidth: '2',
  strokeLinecap: 'round',
});
