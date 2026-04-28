/**
 * drop-zones.ts — pure editor constraint computation.
 *
 * Given a widget, a page document, the active template manifest, and the
 * widget registry, computes which regions (and which positions within each
 * region) are valid drop targets. Pure: no DOM, no store, no side effects.
 *
 * Implements INV-TEMPLATE-02 / -04 (spec: crosscut/page-templates.md):
 *   1. Target region MUST exist in the template manifest.
 *   2. region.maxWidgets MUST NOT be exceeded. For a move WITHIN the same
 *      region the count is unchanged (the widget is already counted); for
 *      an add-from-palette or cross-region move the effective count is
 *      currentLength + 1.
 *
 * Any registered widget may be placed in any region. The platform does
 * not model per-widget slot permissions — widgets are portable across
 * layouts by design.
 *
 * The caller decides the "source" semantics:
 *   sourcePosition = { regionName, index } → move (the widget is currently
 *     at that position in the page document). If the target region equals
 *     sourcePosition.regionName, maxWidgets is evaluated against the
 *     existing count (not +1).
 *   sourcePosition = null → new placement from the palette; treat every
 *     target as +1.
 */

import type { TemplateManifest } from './registry.ts';
import type { PageDocument } from './page-store.ts';

export type ValidRegionReason = 'max-widgets' | 'not-in-template';
export type InvalidRegionReason =
  | 'max-widgets'
  | 'not-in-template'
  | 'unknown-widget';

export interface ValidRegion {
  regionName: string;
  /** length = currentEntries + 1 when valid, all-false same length when a count cap blocks insertion. */
  canInsertAt: boolean[];
  reason?: ValidRegionReason;
}

export interface InvalidRegion {
  regionName: string;
  reason: InvalidRegionReason;
}

export interface ValidTargetsResult {
  validRegions: ValidRegion[];
  invalidRegions: InvalidRegion[];
}

export interface SourcePosition {
  regionName: string;
  index: number;
}

export interface WidgetRegistryLike {
  has?(id: string): boolean;
  get?(id: string): unknown;
  list?(): Array<{ widgetId: string; displayName?: string; [k: string]: unknown }>;
}

export function computeValidTargets(
  widgetId: string,
  pageDoc: PageDocument | null | undefined,
  templateManifest: TemplateManifest | null | undefined,
  widgetRegistry: WidgetRegistryLike | null | undefined,
  sourcePosition: SourcePosition | null = null,
): ValidTargetsResult {
  const result: ValidTargetsResult = { validRegions: [], invalidRegions: [] };

  if (!widgetId || !templateManifest || !Array.isArray(templateManifest.regions)) {
    return result;
  }

  // Resolve widget registration just to confirm the widget is known.
  // Per-widget slot permissions were removed — any registered widget is
  // placeable in any region.
  let widgetKnown = false;
  try {
    if (widgetRegistry && typeof widgetRegistry.has === 'function') {
      widgetKnown = widgetRegistry.has(widgetId);
    } else if (widgetRegistry && typeof widgetRegistry.get === 'function') {
      widgetKnown = widgetRegistry.get(widgetId) != null;
    }
  } catch {
    widgetKnown = false;
  }
  if (!widgetKnown) {
    // Unknown widget → nothing is droppable.
    for (const region of templateManifest.regions) {
      result.invalidRegions.push({
        regionName: region.name,
        reason: 'unknown-widget',
      });
    }
    return result;
  }

  const docRegions: Record<string, unknown> =
    (pageDoc && typeof pageDoc === 'object' && pageDoc.regions) || {};

  for (const region of templateManifest.regions) {
    const regionName = region.name;
    const currentEntries: unknown[] = Array.isArray(docRegions[regionName])
      ? (docRegions[regionName] as unknown[])
      : [];

    // --- maxWidgets (INV-TEMPLATE-04) ---
    const max =
      typeof region.maxWidgets === 'number' && region.maxWidgets >= 0
        ? region.maxWidgets
        : null;

    const movingWithin =
      sourcePosition &&
      sourcePosition.regionName === regionName &&
      Array.isArray(docRegions[regionName]);

    // Effective count after insertion:
    //   - move-within: length unchanged.
    //   - move-from-another or add-from-palette: length + 1.
    const prospectiveCount = movingWithin
      ? currentEntries.length
      : currentEntries.length + 1;

    if (max !== null && prospectiveCount > max) {
      // Region is at capacity; no insertion index is valid, BUT we still
      // return a canInsertAt array of the correct shape so consumers can
      // render disabled indicators without special-casing.
      const slots = currentEntries.length + 1;
      result.validRegions.push({
        regionName,
        canInsertAt: new Array(slots).fill(false),
        reason: 'max-widgets',
      });
      continue;
    }

    // All positions are valid insertion points (0..length inclusive).
    // For a move-within, dropping at the widget's own current slot OR the
    // slot immediately after is a no-op — callers typically still allow
    // them visually (the drop results in "no change"); they are not
    // rejected here because that's a UX decision, not a correctness one.
    const slots = currentEntries.length + 1;
    result.validRegions.push({
      regionName,
      canInsertAt: new Array(slots).fill(true),
    });
  }

  return result;
}
