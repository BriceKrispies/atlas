/**
 * `<page-editor-palette>` — searchable, grouped widget palette for the
 * page editor's left-panel `palette` tab.
 *
 * Surface: `authoring.page-editor.shell.left-panel.palette`. Light-DOM,
 * atlas-* primitives only (C11). Each interactive element gets a `name`
 * so testIds auto-generate (C2).
 *
 * Local state owned here:
 *   - `_search`: filter string applied to the widgetId.
 *   - `_selectedRegion`: target region for chip-add commits. Defaults to
 *     the first region in the page document.
 *   - `_expandedGroups`: Set<groupId>; groups are expanded by default.
 *   - `_recents`: ordered ring of the last 5 widgetIds added via the
 *     controller (observed via the controller's `lastCommit` for
 *     `addWidget`).
 *
 * Commits authored on this surface (`editor:<pageId>:palette`):
 *   - `setSearch`        { search }
 *   - `selectAddRegion`  { region }
 *   - `toggleGroup`      { group, expanded }
 *
 * Commits authored on the SHELL surface via the controller:
 *   - `addWidget` (controller.addWidget) — chip click
 *
 * `lastCommit` for shell-level `addWidget` is read from the controller; we
 * snapshot the last 5 widgetIds added into our `recents` ring.
 */

import { AtlasElement, AtlasSurface } from '@atlas/core';
import { registerTestState, makeCommit, type CommitRecord } from '@atlas/test-state';
import { editorWidgetSchemas, editorWidgetManifests } from '../editor-widgets/index.ts';
import type { PageEditorController, PageEditorStateSnapshot } from '../state.ts';

const SURFACE_ID = 'authoring.page-editor.shell.left-panel.palette';

const styles = `
  page-editor-palette {
    display: block;
    font: inherit;
  }
  page-editor-palette atlas-stack[name="add-widget-tab-content"] {
    display: block;
  }
  page-editor-palette atlas-box[data-role="search-row"],
  page-editor-palette atlas-box[data-role="region-row"] {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-xs);
  }
  page-editor-palette atlas-box[data-role="group"] {
    display: block;
    margin-top: var(--atlas-space-sm);
  }
  page-editor-palette atlas-box[data-role="group-header"] {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    min-height: 44px;
    cursor: pointer;
    user-select: none;
  }
  page-editor-palette atlas-box[data-role="chip-list"] {
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-xs);
    padding-left: var(--atlas-space-md);
  }
  page-editor-palette atlas-button[data-palette-chip] {
    min-height: 44px;
    text-align: left;
    justify-content: flex-start;
  }
`;

let stylesInstalled = false;
function ensureStylesInstalled(): void {
  if (stylesInstalled) return;
  if (typeof document === 'undefined') return;
  const tag = document.createElement('style');
  tag.setAttribute('data-atlas-page-editor-palette', '');
  tag.textContent = styles;
  document.head.appendChild(tag);
  stylesInstalled = true;
}

interface PaletteSnapshot {
  surfaceId: string;
  pageId: string;
  search: string;
  selectedRegion: string | null;
  expandedGroups: string[];
  collapsedGroups: string[];
  recentWidgetIds: ReadonlyArray<string>;
  filteredWidgetIds: ReadonlyArray<string>;
  lastCommit: CommitRecord | null;
}

const RECENTS_LIMIT = 5;

interface ManifestLite {
  widgetId: string;
  category?: string;
  displayName?: string;
}

function manifestCategory(m: ManifestLite): string {
  if (typeof m.category === 'string' && m.category.length > 0) return m.category;
  // Fall back to namespace prefix of the widgetId, e.g. `sandbox.heading` →
  // `sandbox`. Widgets without a `.` separator land in `general`.
  const dot = m.widgetId.indexOf('.');
  return dot > 0 ? m.widgetId.slice(0, dot) : 'general';
}

interface GroupDescriptor {
  id: string;
  label: string;
  widgetIds: string[];
}

function buildGroups(
  manifests: ReadonlyArray<ManifestLite>,
  filterFn: (id: string) => boolean,
): GroupDescriptor[] {
  const buckets = new Map<string, string[]>();
  for (const m of manifests) {
    if (!filterFn(m.widgetId)) continue;
    const cat = manifestCategory(m);
    let arr = buckets.get(cat);
    if (!arr) {
      arr = [];
      buckets.set(cat, arr);
    }
    arr.push(m.widgetId);
  }
  return [...buckets.entries()]
    .map(([id, ids]) => ({ id, label: id, widgetIds: ids.slice().sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export class PageEditorPaletteElement extends AtlasSurface {
  static override surfaceId = SURFACE_ID;

  private _controller: PageEditorController | null = null;
  private _unsubscribe: (() => void) | null = null;
  private _disposeTestState: (() => void) | null = null;
  private _stateKey: string | null = null;
  private _lastSnapshot: PageEditorStateSnapshot | null = null;
  private _search = '';
  private _selectedRegion: string | null = null;
  private _expandedGroups: Set<string> | null = null; // null = "all expanded by default"
  private _collapsedGroups: Set<string> = new Set();
  private _recents: string[] = [];
  private _seenAddCommitAt = 0;
  private _lastCommit: CommitRecord | null = null;

  // ---- public api ----

  set controller(c: PageEditorController | null) {
    if (this._controller === c) return;
    this._teardownController();
    this._controller = c;
    if (this.isConnected && c) this._setupController();
  }
  get controller(): PageEditorController | null {
    return this._controller;
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    ensureStylesInstalled();
    if (this._controller) this._setupController();
    else this._render();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback?.();
    this._teardownController();
  }

  // ---- controller wiring ----

  private _setupController(): void {
    const c = this._controller;
    if (!c) return;
    this._lastSnapshot = c.getSnapshot();
    this._reconcileSelectedRegion();
    this._unsubscribe = c.subscribe((snap) => {
      this._lastSnapshot = snap;
      this._observeAddCommit(snap);
      this._reconcileSelectedRegion();
      this._render();
    });
    this._stateKey = `editor:${c.pageId}:palette`;
    this._disposeTestState = registerTestState(this._stateKey, () => this._readSnapshot());
    this._render();
  }

  private _teardownController(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._disposeTestState?.();
    this._disposeTestState = null;
    this._stateKey = null;
    this._lastSnapshot = null;
  }

  /** If selectedRegion is unset / stale, default to the first available region. */
  private _reconcileSelectedRegion(): void {
    const regions = this._lastSnapshot?.regions ?? [];
    const names = regions.map((r) => r.name);
    if (names.length === 0) {
      this._selectedRegion = null;
      return;
    }
    if (!this._selectedRegion || !names.includes(this._selectedRegion)) {
      this._selectedRegion = names[0] ?? null;
    }
  }

  /** Watch the controller's lastCommit; fold addWidget into the recents ring. */
  private _observeAddCommit(snap: PageEditorStateSnapshot): void {
    const c = snap.lastCommit;
    if (!c) return;
    if (c.at <= this._seenAddCommitAt) return;
    this._seenAddCommitAt = c.at;
    if (c.intent !== 'addWidget') return;
    const patch = c.patch as { widgetId?: string } | undefined;
    const widgetId = patch?.widgetId;
    if (typeof widgetId !== 'string' || widgetId.length === 0) return;
    const next = [widgetId, ...this._recents.filter((w) => w !== widgetId)];
    this._recents = next.slice(0, RECENTS_LIMIT);
  }

  // ---- snapshot reader ----

  private _allManifests(): ReadonlyArray<ManifestLite> {
    return editorWidgetManifests as ReadonlyArray<ManifestLite>;
  }

  private _filterFn(): (id: string) => boolean {
    const s = this._search.trim().toLowerCase();
    if (!s) return () => true;
    return (id: string): boolean => id.toLowerCase().includes(s);
  }

  private _isGroupExpanded(groupId: string): boolean {
    return !this._collapsedGroups.has(groupId);
  }

  private _readSnapshot(): PaletteSnapshot {
    const filter = this._filterFn();
    const filtered: string[] = [];
    for (const widgetId of Object.keys(editorWidgetSchemas)) {
      if (filter(widgetId)) filtered.push(widgetId);
    }
    const groups = buildGroups(this._allManifests(), filter);
    const expanded: string[] = [];
    const collapsed: string[] = [];
    for (const g of groups) {
      if (this._isGroupExpanded(g.id)) expanded.push(g.id);
      else collapsed.push(g.id);
    }
    return {
      surfaceId: SURFACE_ID,
      pageId: this._lastSnapshot?.pageId ?? '',
      search: this._search,
      selectedRegion: this._selectedRegion,
      expandedGroups: expanded,
      collapsedGroups: collapsed,
      recentWidgetIds: this._recents.slice(),
      filteredWidgetIds: filtered,
      lastCommit: this._lastCommit,
    };
  }

  private _recordLocalCommit(intent: string, patch: Record<string, unknown>): void {
    if (!this._stateKey) return;
    this._lastCommit = makeCommit(this._stateKey, intent, patch);
  }

  // ---- render ----

  private _render(): void {
    this.textContent = '';
    const snap = this._lastSnapshot;
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'add-widget-tab-content');

    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '4');
    heading.textContent = 'Add widget';
    wrap.appendChild(heading);

    // Search row.
    const searchRow = document.createElement('atlas-box');
    searchRow.setAttribute('data-role', 'search-row');
    const searchInput = document.createElement('atlas-input') as HTMLElement & { value: string };
    searchInput.setAttribute('name', 'palette-search');
    searchInput.setAttribute('aria-label', 'Search widgets');
    searchInput.setAttribute('placeholder', 'Search widgets…');
    searchInput.value = this._search;
    const onSearchEvent = (ev: Event): void => {
      const detail = (ev as unknown as CustomEvent<{ value?: string }>).detail;
      const next =
        (detail && typeof detail === 'object' && typeof detail.value === 'string'
          ? detail.value
          : undefined)
        ?? (ev.target as HTMLInputElement | null)?.value
        ?? '';
      this._setSearch(next);
    };
    searchInput.addEventListener('input', onSearchEvent);
    // `<atlas-input>` may emit `change` on commit too — listen for both.
    searchInput.addEventListener('change', onSearchEvent);
    searchRow.appendChild(searchInput);
    wrap.appendChild(searchRow);

    // Region selector row.
    const regions = snap?.regions ?? [];
    if (regions.length > 0) {
      const regionRow = document.createElement('atlas-box');
      regionRow.setAttribute('data-role', 'region-row');
      const regionLabel = document.createElement('atlas-text');
      regionLabel.setAttribute('variant', 'muted');
      regionLabel.textContent = 'Add to:';
      regionRow.appendChild(regionLabel);
      const regionSelect = document.createElement('atlas-select') as HTMLElement & {
        options: unknown;
        value: string;
      };
      regionSelect.setAttribute('name', 'palette-region-select');
      regionSelect.setAttribute('aria-label', 'Target region');
      regionSelect.options = regions.map((r) => ({ value: r.name, label: r.name }));
      regionSelect.value = this._selectedRegion ?? regions[0]?.name ?? '';
      regionSelect.addEventListener('change', (ev) => {
        const next = (ev as CustomEvent<{ value: string }>).detail?.value
          ?? regionSelect.value
          ?? '';
        this._setSelectedRegion(next);
      });
      regionRow.appendChild(regionSelect);
      wrap.appendChild(regionRow);
    } else {
      const hint = document.createElement('atlas-text');
      hint.setAttribute('variant', 'muted');
      hint.textContent = 'Pick a template with regions to enable adding widgets.';
      wrap.appendChild(hint);
    }

    // Recents section (always rendered when non-empty so chip-click commits
    // keep flowing into a stable testId).
    if (this._recents.length > 0) {
      const recentsBox = this._renderRecents(this._filterFn());
      if (recentsBox) wrap.appendChild(recentsBox);
    }

    // Grouped chip list.
    const groups = buildGroups(this._allManifests(), this._filterFn());
    if (groups.length === 0) {
      const empty = document.createElement('atlas-text');
      empty.setAttribute('variant', 'muted');
      empty.setAttribute('name', 'palette-empty');
      empty.textContent = this._search.length > 0
        ? `No widgets match "${this._search}".`
        : 'No widgets available.';
      wrap.appendChild(empty);
    } else {
      for (const group of groups) {
        wrap.appendChild(this._renderGroup(group));
      }
    }

    this.appendChild(wrap);
  }

  private _renderRecents(filter: (id: string) => boolean): HTMLElement | null {
    const visible = this._recents.filter((id) => filter(id));
    if (visible.length === 0) return null;
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('data-role', 'group');
    wrap.setAttribute('data-group-id', 'recents');

    const header = document.createElement('atlas-box');
    header.setAttribute('data-role', 'group-header');
    const title = document.createElement('atlas-text');
    title.setAttribute('variant', 'small');
    title.setAttribute('name', 'palette-group-label');
    title.setAttribute('data-group-id', 'recents');
    title.textContent = 'Recent';
    header.appendChild(title);
    wrap.appendChild(header);

    const list = document.createElement('atlas-box');
    list.setAttribute('data-role', 'chip-list');
    for (const widgetId of visible) {
      list.appendChild(this._buildChip(widgetId, 'recents'));
    }
    wrap.appendChild(list);
    return wrap;
  }

  private _renderGroup(group: GroupDescriptor): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('data-role', 'group');
    wrap.setAttribute('data-group-id', group.id);

    const expanded = this._isGroupExpanded(group.id);
    const header = document.createElement('atlas-box');
    header.setAttribute('data-role', 'group-header');

    const toggle = document.createElement('atlas-button');
    toggle.setAttribute('variant', 'ghost');
    toggle.setAttribute('size', 'sm');
    toggle.setAttribute('name', 'palette-group-toggle');
    toggle.setAttribute('data-group-id', group.id);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} group ${group.label}`);
    toggle.textContent = expanded ? '▾' : '▸';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleGroup(group.id);
    });
    header.appendChild(toggle);

    const title = document.createElement('atlas-text');
    title.setAttribute('variant', 'small');
    title.setAttribute('name', 'palette-group-label');
    title.setAttribute('data-group-id', group.id);
    title.textContent = `${group.label} (${group.widgetIds.length})`;
    header.appendChild(title);

    wrap.appendChild(header);

    if (expanded) {
      const list = document.createElement('atlas-box');
      list.setAttribute('data-role', 'chip-list');
      for (const widgetId of group.widgetIds) {
        list.appendChild(this._buildChip(widgetId, group.id));
      }
      wrap.appendChild(list);
    }

    return wrap;
  }

  private _buildChip(widgetId: string, groupId: string): HTMLElement {
    const chip = document.createElement('atlas-button');
    chip.setAttribute('name', `palette-${widgetId}`);
    chip.setAttribute('data-palette-chip', '');
    chip.setAttribute('data-widget-id', widgetId);
    chip.setAttribute('data-group-id', groupId);
    chip.setAttribute('size', 'sm');
    chip.setAttribute('variant', 'ghost');
    chip.textContent = widgetId;
    chip.addEventListener('click', () => {
      const region = this._selectedRegion;
      if (!region) return;
      void this._controller?.addWidget({ widgetId, region });
    });
    return chip;
  }

  // ---- local intents ----

  private _setSearch(next: string): void {
    if (this._search === next) return;
    this._search = next;
    this._recordLocalCommit('setSearch', { search: next });
    this._render();
  }

  private _setSelectedRegion(next: string): void {
    if (this._selectedRegion === next) return;
    if (!next) return;
    this._selectedRegion = next;
    this._recordLocalCommit('selectAddRegion', { region: next });
    this._render();
  }

  private _toggleGroup(groupId: string): void {
    const expanded = !this._collapsedGroups.has(groupId);
    if (expanded) this._collapsedGroups.add(groupId);
    else this._collapsedGroups.delete(groupId);
    this._recordLocalCommit('toggleGroup', { group: groupId, expanded: !expanded });
    this._render();
  }
}

AtlasElement.define('page-editor-palette', PageEditorPaletteElement);
