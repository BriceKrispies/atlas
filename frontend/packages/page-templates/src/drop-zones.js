/**
 * drop-zones.js — pure editor constraint computation.
 *
 * Given a widget, a page document, the active template manifest, and the
 * widget registry, computes which regions (and which positions within each
 * region) are valid drop targets. Pure: no DOM, no store, no side effects.
 *
 * Implements INV-TEMPLATE-02 / -03 / -04 (spec: crosscut/page-templates.md):
 *   1. Target region MUST exist in the template manifest.
 *   2. Widget's manifest.slots MUST include the region name — unless the
 *      region declares `allowedSlots`, in which case one of the widget's
 *      manifest.slots values MUST appear in `allowedSlots`. A widget with
 *      no declared `slots` is allowed in regions without `allowedSlots`
 *      only.
 *   3. region.maxWidgets MUST NOT be exceeded. For a move WITHIN the same
 *      region the count is unchanged (the widget is already counted); for
 *      an add-from-palette or cross-region move the effective count is
 *      currentLength + 1.
 *
 * The caller decides the "source" semantics:
 *   sourcePosition = { regionName, index } → move (the widget is currently
 *     at that position in the page document). If the target region equals
 *     sourcePosition.regionName, maxWidgets is evaluated against the
 *     existing count (not +1).
 *   sourcePosition = null → new placement from the palette; treat every
 *     target as +1.
 */

/**
 * @typedef {object} ValidRegion
 * @property {string} regionName
 * @property {boolean[]} canInsertAt — length = currentEntries + 1 when valid,
 *   all-false same length when a count cap blocks insertion.
 * @property {('max-widgets'|'slot-permission'|'not-in-template')} [reason]
 */

/**
 * @typedef {object} InvalidRegion
 * @property {string} regionName
 * @property {('max-widgets'|'slot-permission'|'not-in-template')} reason
 */

/**
 * @param {string} widgetId
 * @param {object} pageDoc
 * @param {object} templateManifest
 * @param {object} widgetRegistry — must expose has(id)/get(id) with { manifest }
 * @param {{ regionName: string, index: number } | null} [sourcePosition]
 * @returns {{ validRegions: ValidRegion[], invalidRegions: InvalidRegion[] }}
 */
export function computeValidTargets(
  widgetId,
  pageDoc,
  templateManifest,
  widgetRegistry,
  sourcePosition = null,
) {
  const result = { validRegions: [], invalidRegions: [] };

  if (!widgetId || !templateManifest || !Array.isArray(templateManifest.regions)) {
    return result;
  }

  // Resolve widget manifest (for slot permissions). If the registry doesn't
  // know the widget, nothing is droppable.
  let widgetManifest = null;
  try {
    if (widgetRegistry && typeof widgetRegistry.get === 'function') {
      const entry = widgetRegistry.get(widgetId);
      widgetManifest = entry?.manifest ?? null;
    }
  } catch {
    widgetManifest = null;
  }
  if (!widgetManifest) {
    // Unknown widget → every region is invalid on slot-permission grounds.
    for (const region of templateManifest.regions) {
      result.invalidRegions.push({
        regionName: region.name,
        reason: 'slot-permission',
      });
    }
    return result;
  }

  const widgetSlots = Array.isArray(widgetManifest.slots) ? widgetManifest.slots : null;
  const docRegions = (pageDoc && typeof pageDoc === 'object' && pageDoc.regions) || {};

  for (const region of templateManifest.regions) {
    const regionName = region.name;
    const currentEntries = Array.isArray(docRegions[regionName])
      ? docRegions[regionName]
      : [];

    // --- Slot permission (INV-TEMPLATE-03) ---
    const hasAllowedSlots =
      Array.isArray(region.allowedSlots) && region.allowedSlots.length > 0;
    let slotPermitted;
    if (hasAllowedSlots) {
      // Widget must declare at least one slot that appears in allowedSlots.
      if (!widgetSlots) {
        slotPermitted = false;
      } else {
        slotPermitted = widgetSlots.some((s) => region.allowedSlots.includes(s));
      }
    } else if (widgetSlots == null) {
      // No widget slot declaration AND no allowedSlots → allowed.
      slotPermitted = true;
    } else {
      // Default rule: widget.slots must include region.name.
      slotPermitted = widgetSlots.includes(regionName);
    }
    if (!slotPermitted) {
      result.invalidRegions.push({ regionName, reason: 'slot-permission' });
      continue;
    }

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
    const prospectiveCount = movingWithin ? currentEntries.length : currentEntries.length + 1;

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
