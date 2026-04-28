/**
 * Pure selection state — Set<rowKey> wrapped with helpers that respect
 * single/multi/none modes.
 *
 * The functions are pure; callers replace the Set rather than mutate in place.
 */

export type SelectionMode = 'none' | 'single' | 'multi';
export type SelectionKey = string | number;

export function selectRow(
  mode: SelectionMode,
  selection: Set<SelectionKey>,
  key: SelectionKey,
): Set<SelectionKey> {
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

export function unselectRow(
  mode: SelectionMode,
  selection: Set<SelectionKey>,
  key: SelectionKey,
): Set<SelectionKey> {
  if (mode === 'none' || !selection.has(key)) return selection;
  const next = new Set(selection);
  next.delete(key);
  return next;
}

export function toggleRow(
  mode: SelectionMode,
  selection: Set<SelectionKey>,
  key: SelectionKey,
): Set<SelectionKey> {
  return selection.has(key)
    ? unselectRow(mode, selection, key)
    : selectRow(mode, selection, key);
}

/**
 * Toggle every key in `pageKeys`: if all are selected, deselect them; else
 * select them all. Only meaningful in multi mode.
 */
export function toggleAllOnPage(
  mode: SelectionMode,
  selection: Set<SelectionKey>,
  pageKeys: ReadonlyArray<SelectionKey>,
): Set<SelectionKey> {
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

export function clearSelection(selection: Set<SelectionKey>): Set<SelectionKey> {
  if (selection.size === 0) return selection;
  return new Set();
}
