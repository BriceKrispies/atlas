/**
 * Persistent panel-size preferences for the page-editor shell.
 *
 * The shell reads sizes at construction time and writes them on every
 * `panelResize` commit. Open/closed state and active tab are derived from
 * mode + selection in `derivePanelsForMode`, so they are NOT persisted —
 * a returning user gets a fresh, mode-appropriate layout but with their
 * preferred widths and heights.
 */

import { PANEL_SIZE_BOUNDS, type PanelId } from '../state.ts';

const STORAGE_KEY = 'atlas:authoring.page-editor.shell.panels';

export interface PersistedPanelSizes {
  left?: number;
  right?: number;
  bottom?: number;
}

export function loadPanelSizes(): PersistedPanelSizes {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<PanelId, unknown>>;
    const out: PersistedPanelSizes = {};
    for (const panel of ['left', 'right', 'bottom'] as const) {
      const candidate = parsed[panel];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        const { min, max } = PANEL_SIZE_BOUNDS[panel];
        out[panel] = Math.max(min, Math.min(max, Math.round(candidate)));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function savePanelSize(panel: PanelId, size: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const current = loadPanelSizes();
    current[panel] = size;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* swallow quota / disabled-storage failures — preference persistence is best-effort */
  }
}
