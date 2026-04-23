/**
 * Pure selection state — Set<rowKey> wrapped with helpers that respect
 * single/multi/none modes.
 *
 * The functions are pure; callers replace the Set rather than mutate in place.
 */

/**
 * @param {'none' | 'single' | 'multi'} mode
 * @param {Set<string | number>} selection
 * @param {string | number} key
 * @returns {Set<string | number>}
 */
export function selectRow(mode, selection, key) {
  if (mode === 'none') return selection;
  if (mode === 'single') {
    if (selection.size === 1 && selection.has(key)) return selection;
    return new Set([key]);
  }
  if (selection.has(key)) return selection;
  const next = new Set(selection);
  next.add(key);
  return next;
}

/**
 * @param {'none' | 'single' | 'multi'} mode
 * @param {Set<string | number>} selection
 * @param {string | number} key
 * @returns {Set<string | number>}
 */
export function unselectRow(mode, selection, key) {
  if (mode === 'none' || !selection.has(key)) return selection;
  const next = new Set(selection);
  next.delete(key);
  return next;
}

/**
 * @param {'none' | 'single' | 'multi'} mode
 * @param {Set<string | number>} selection
 * @param {string | number} key
 */
export function toggleRow(mode, selection, key) {
  return selection.has(key)
    ? unselectRow(mode, selection, key)
    : selectRow(mode, selection, key);
}

/**
 * Toggle every key in `pageKeys`: if all are selected, deselect them; else
 * select them all. Only meaningful in multi mode.
 *
 * @param {'none' | 'single' | 'multi'} mode
 * @param {Set<string | number>} selection
 * @param {Array<string | number>} pageKeys
 */
export function toggleAllOnPage(mode, selection, pageKeys) {
  if (mode !== 'multi' || pageKeys.length === 0) return selection;
  const allSelected = pageKeys.every((k) => selection.has(k));
  const next = new Set(selection);
  if (allSelected) {
    for (const k of pageKeys) next.delete(k);
  } else {
    for (const k of pageKeys) next.add(k);
  }
  return next;
}

/**
 * @param {Set<string | number>} selection
 */
export function clearSelection(selection) {
  if (selection.size === 0) return selection;
  return new Set();
}
