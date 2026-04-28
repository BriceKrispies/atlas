/**
 * `<page-editor-outline>` — region → widget tree for the page editor's
 * left panel `outline` tab.
 *
 * Surface: `authoring.page-editor.shell.left-panel.outline`. Element is
 * light-DOM (per the panel-base host) and uses atlas-* primitives only
 * inside its rendered tree (C11). Each interactive element carries a
 * `name` attribute so its `data-testid` is auto-generated as
 * `authoring.page-editor.shell.left-panel.outline.<name>` (C2).
 *
 * Local state owned here:
 *   - `_collapsed`: Set<regionName> — region rows can be expanded /
 *     collapsed; persisted only in the element instance.
 *   - `_dragId`: instanceId currently being dragged, or null.
 *   - `_dragOver`: { region, index } the pointer is hovering over, or null.
 *
 * Commits authored on this surface (`editor:<pageId>:outline`):
 *   - `toggleRegion` { region, expanded }
 *   - `dragStart`    { instanceId, fromRegion }
 *   - `dragEnd`      { instanceId, dropped }
 *
 * Commits authored on the SHELL surface via the controller:
 *   - `selectWidget` (controller.selectWidget)
 *   - `moveWidget`   (controller.moveWidget) — outline drag-reorder
 *
 * The empty-state hint renders an `<atlas-text variant="muted">` per C4.1
 * when no regions / no widgets exist.
 */

import { AtlasElement, AtlasSurface } from '@atlas/core';
import { registerTestState, makeCommit, type CommitRecord } from '@atlas/test-state';
import type { PageEditorController, PageEditorStateSnapshot, Region } from '../state.ts';

const SURFACE_ID = 'authoring.page-editor.shell.left-panel.outline';

const styles = `
  page-editor-outline {
    display: block;
    font: inherit;
  }
  page-editor-outline atlas-stack[name="outline-tab-content"] {
    display: block;
  }
  page-editor-outline atlas-box[data-row="region"],
  page-editor-outline atlas-box[data-row="widget"] {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    min-height: 44px;
    padding: 0 var(--atlas-space-xs);
    cursor: pointer;
    border-radius: var(--atlas-radius-sm);
  }
  page-editor-outline atlas-box[data-row="region"]:hover,
  page-editor-outline atlas-box[data-row="widget"]:hover {
    background: var(--atlas-color-surface-strong, rgba(0,0,0,0.04));
  }
  page-editor-outline atlas-box[data-row="widget"][data-selected="true"] {
    background: var(--atlas-color-primary-soft, rgba(59,130,246,0.12));
  }
  page-editor-outline atlas-box[data-row="widget"][data-drag-over="true"] {
    box-shadow: inset 0 2px 0 var(--atlas-color-primary);
  }
  page-editor-outline atlas-box[data-row="region"][data-drag-over="true"] {
    background: var(--atlas-color-primary-soft, rgba(59,130,246,0.18));
  }
  page-editor-outline atlas-box[data-row="widget"] {
    padding-left: var(--atlas-space-md);
  }
  page-editor-outline atlas-box[data-role="drag-handle"] {
    width: 16px;
    text-align: center;
    color: var(--atlas-color-text-muted, #64748b);
    cursor: grab;
    user-select: none;
  }
  page-editor-outline atlas-box[data-row="widget"][data-dragging="true"] {
    opacity: 0.5;
  }
`;

let stylesInstalled = false;
function ensureStylesInstalled(): void {
  if (stylesInstalled) return;
  if (typeof document === 'undefined') return;
  const tag = document.createElement('style');
  tag.setAttribute('data-atlas-page-editor-outline', '');
  tag.textContent = styles;
  document.head.appendChild(tag);
  stylesInstalled = true;
}

interface DragState {
  instanceId: string;
  fromRegion: string;
}

interface DragOverState {
  region: string;
  index: number; // insertion index within region
}

interface OutlineSnapshot {
  surfaceId: string;
  pageId: string;
  expandedRegions: string[];
  collapsedRegions: string[];
  drag: DragState | null;
  dragOver: DragOverState | null;
  selection: ReadonlyArray<string>;
  lastCommit: CommitRecord | null;
}

const MAX_LABEL_LEN = 28;
function truncate(label: string, max = MAX_LABEL_LEN): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

export class PageEditorOutlineElement extends AtlasSurface {
  static override surfaceId = SURFACE_ID;

  private _controller: PageEditorController | null = null;
  private _unsubscribe: (() => void) | null = null;
  private _disposeTestState: (() => void) | null = null;
  private _stateKey: string | null = null;
  private _lastSnapshot: PageEditorStateSnapshot | null = null;
  private _collapsed: Set<string> = new Set();
  private _drag: DragState | null = null;
  private _dragOver: DragOverState | null = null;
  private _lastCommit: CommitRecord | null = null;
  private _onPointerMove: ((e: PointerEvent) => void) | null = null;
  private _onPointerUp: ((e: PointerEvent) => void) | null = null;

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
    this._teardownPointerListeners();
  }

  // ---- controller wiring ----

  private _setupController(): void {
    const c = this._controller;
    if (!c) return;
    this._lastSnapshot = c.getSnapshot();
    this._unsubscribe = c.subscribe((snap) => {
      this._lastSnapshot = snap;
      this._render();
    });
    this._stateKey = `editor:${c.pageId}:outline`;
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

  private _readSnapshot(): OutlineSnapshot {
    const snap = this._lastSnapshot;
    const allRegions = (snap?.regions ?? []).map((r) => r.name);
    const collapsed = allRegions.filter((n) => this._collapsed.has(n));
    const expanded = allRegions.filter((n) => !this._collapsed.has(n));
    return {
      surfaceId: SURFACE_ID,
      pageId: snap?.pageId ?? '',
      expandedRegions: expanded,
      collapsedRegions: collapsed,
      drag: this._drag,
      dragOver: this._dragOver,
      selection: snap?.selectedWidgetInstanceIds ?? [],
      lastCommit: this._lastCommit,
    };
  }

  // ---- local commits ----

  private _recordLocalCommit(intent: string, patch: Record<string, unknown>): void {
    if (!this._stateKey) return;
    this._lastCommit = makeCommit(this._stateKey, intent, patch);
  }

  // ---- render ----

  private _render(): void {
    this.textContent = '';
    const snap = this._lastSnapshot;
    if (!snap) return;

    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'xs');
    wrap.setAttribute('name', 'outline-tab-content');

    const header = document.createElement('atlas-heading');
    header.setAttribute('level', '4');
    header.textContent = 'Outline';
    wrap.appendChild(header);

    const totalWidgets = snap.widgetInstances.length;
    if (snap.regions.length === 0 || totalWidgets === 0) {
      const empty = document.createElement('atlas-text');
      empty.setAttribute('variant', 'muted');
      empty.setAttribute('name', 'outline-empty');
      empty.textContent =
        snap.regions.length === 0
          ? 'Pick a template with regions to see an outline.'
          : 'This page has no widgets. Add one from the palette.';
      wrap.appendChild(empty);
      this.appendChild(wrap);
      return;
    }

    for (const region of snap.regions) {
      wrap.appendChild(this._renderRegionRow(region, snap));
      const expanded = !this._collapsed.has(region.name);
      if (expanded) {
        wrap.appendChild(this._renderRegionWidgets(region, snap));
      }
    }

    this.appendChild(wrap);
  }

  private _renderRegionRow(region: Region, snap: PageEditorStateSnapshot): HTMLElement {
    const row = document.createElement('atlas-box');
    row.setAttribute('data-row', 'region');
    row.setAttribute('data-region', region.name);
    row.setAttribute('role', 'treeitem');
    const expanded = !this._collapsed.has(region.name);
    row.setAttribute('aria-expanded', String(expanded));
    if (this._dragOver && this._dragOver.region === region.name && this._dragOver.index === region.widgetIds.length) {
      row.setAttribute('data-drag-over', 'true');
    }

    const toggle = document.createElement('atlas-button');
    toggle.setAttribute('variant', 'ghost');
    toggle.setAttribute('size', 'sm');
    toggle.setAttribute('name', 'outline-region-toggle');
    toggle.setAttribute('data-region', region.name);
    toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} region ${region.name}`);
    toggle.textContent = expanded ? '▾' : '▸';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleRegion(region.name);
    });
    row.appendChild(toggle);

    const label = document.createElement('atlas-text');
    label.setAttribute('variant', 'small');
    label.setAttribute('name', 'outline-region-label');
    label.setAttribute('data-region', region.name);
    label.textContent = `${region.name} (${region.widgetIds.length})`;
    row.appendChild(label);

    // Region row also acts as a drop target for empty-region drops.
    row.addEventListener('pointerenter', () => {
      if (!this._drag) return;
      this._dragOver = { region: region.name, index: region.widgetIds.length };
      this._render();
    });

    void snap;
    return row;
  }

  private _renderRegionWidgets(region: Region, snap: PageEditorStateSnapshot): HTMLElement {
    const list = document.createElement('atlas-stack');
    list.setAttribute('gap', 'xs');
    const selected = new Set(snap.selectedWidgetInstanceIds);
    const map = new Map(snap.widgetInstances.map((w) => [w.instanceId, w]));

    for (let i = 0; i < region.widgetIds.length; i++) {
      const instanceId = region.widgetIds[i]!;
      const widget = map.get(instanceId);
      const widgetId = widget?.widgetId ?? '(unknown)';
      list.appendChild(this._renderWidgetRow({
        region: region.name,
        index: i,
        instanceId,
        widgetId,
        selected: selected.has(instanceId),
      }));
    }
    return list;
  }

  private _renderWidgetRow(args: {
    region: string;
    index: number;
    instanceId: string;
    widgetId: string;
    selected: boolean;
  }): HTMLElement {
    const { region, index, instanceId, widgetId, selected } = args;
    const row = document.createElement('atlas-box');
    row.setAttribute('data-row', 'widget');
    row.setAttribute('data-instance-id', instanceId);
    row.setAttribute('data-region', region);
    row.setAttribute('data-index', String(index));
    row.setAttribute('role', 'treeitem');
    if (selected) row.setAttribute('data-selected', 'true');
    if (this._drag?.instanceId === instanceId) row.setAttribute('data-dragging', 'true');
    if (this._dragOver && this._dragOver.region === region && this._dragOver.index === index) {
      row.setAttribute('data-drag-over', 'true');
    }

    const handle = document.createElement('atlas-box');
    handle.setAttribute('data-role', 'drag-handle');
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = '⋮⋮';
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._beginDrag({ instanceId, fromRegion: region });
    });
    row.appendChild(handle);

    const label = document.createElement('atlas-text');
    label.setAttribute('variant', 'small');
    label.setAttribute('name', 'outline-node-label');
    label.setAttribute('data-instance-id', instanceId);
    label.textContent = truncate(widgetId);
    row.appendChild(label);

    // Make the whole row a click-to-select target.
    row.addEventListener('click', (e) => {
      const me = e as MouseEvent;
      const additive = me.shiftKey || me.metaKey || me.ctrlKey;
      this._controller?.selectWidget(instanceId, { additive });
    });
    // Also a drop target while a drag is in flight.
    row.addEventListener('pointerenter', () => {
      if (!this._drag) return;
      this._dragOver = { region, index };
      this._render();
    });

    return row;
  }

  // ---- local intents ----

  private _toggleRegion(region: string): void {
    // True iff the region was collapsed before this click.
    const wasCollapsed = this._collapsed.has(region);
    if (wasCollapsed) this._collapsed.delete(region);
    else this._collapsed.add(region);
    // `expanded` describes the post-toggle state.
    const expanded = wasCollapsed;
    this._recordLocalCommit('toggleRegion', { region, expanded });
    this._render();
  }

  // ---- drag mechanics ----

  private _beginDrag(state: DragState): void {
    this._drag = state;
    this._dragOver = null;
    this._recordLocalCommit('dragStart', { instanceId: state.instanceId, fromRegion: state.fromRegion });
    this._render();

    const onMove = (_ev: PointerEvent): void => {
      // pointerenter on rows already updates _dragOver. This handler exists
      // so we can release pointer capture cleanly on up.
    };
    const onUp = (_ev: PointerEvent): void => {
      void this._endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this._onPointerMove = onMove;
    this._onPointerUp = onUp;
  }

  private async _endDrag(): Promise<void> {
    const drag = this._drag;
    const target = this._dragOver;
    this._teardownPointerListeners();
    this._drag = null;
    this._dragOver = null;
    let dropped = false;

    if (drag && target && this._controller) {
      // Adjust toIndex if the drop is in the same region after the source.
      let toIndex = target.index;
      if (target.region === drag.fromRegion) {
        const snap = this._lastSnapshot;
        const r = snap?.regions.find((rr) => rr.name === drag.fromRegion);
        const fromIndex = r?.widgetIds.indexOf(drag.instanceId) ?? -1;
        if (fromIndex >= 0 && fromIndex < toIndex) toIndex -= 1;
        if (fromIndex === toIndex) {
          // No-op move. Skip controller call so a no-op commit doesn't land.
          this._recordLocalCommit('dragEnd', { instanceId: drag.instanceId, dropped: false });
          this._render();
          return;
        }
      }
      const res = await this._controller.moveWidget({
        instanceId: drag.instanceId,
        toRegion: target.region,
        toIndex,
      });
      dropped = res.ok;
    }

    this._recordLocalCommit('dragEnd', { instanceId: drag?.instanceId ?? null, dropped });
    this._render();
  }

  private _teardownPointerListeners(): void {
    if (this._onPointerMove) {
      window.removeEventListener('pointermove', this._onPointerMove);
      this._onPointerMove = null;
    }
    if (this._onPointerUp) {
      window.removeEventListener('pointerup', this._onPointerUp);
      this._onPointerUp = null;
    }
  }

  /**
   * Programmatic API for tests / callers that want to drive a drop without
   * synthesising pointer events. The toRegion / toIndex are passed straight
   * through to `controller.moveWidget`.
   */
  async commitMove(args: { instanceId: string; toRegion: string; toIndex: number }): Promise<boolean> {
    if (!this._controller) return false;
    this._drag = null;
    this._dragOver = null;
    const res = await this._controller.moveWidget(args);
    this._recordLocalCommit('dragEnd', { instanceId: args.instanceId, dropped: res.ok });
    this._render();
    return res.ok;
  }
}

AtlasElement.define('page-editor-outline', PageEditorOutlineElement);
