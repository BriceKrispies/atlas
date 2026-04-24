/**
 * edit-mount.js — attaches editor UI to a <content-page>.
 *
 * The UI is a thin adapter over the `EditorAPI`. Every user interaction
 * (click, keyboard, drag) ultimately calls one of editor.add / move /
 * remove. Agents and tests can skip the UI entirely and call the API
 * directly via `contentPageEl.editor.add({...})`.
 *
 * Slot model:
 *
 *   Each <section data-slot="{region}"> in the template holds AT MOST
 *   ONE widget. An empty region renders a single drop slot; a filled
 *   region renders just the cell (no drop slot — the region is not a
 *   drop target). Nothing reorders on drop or pickup.
 *
 *   <section data-slot="{region}">
 *     // filled:
 *     <div data-widget-cell data-instance-id="{id}" name="cell-{id}">
 *       <atlas-box data-cell-chrome>
 *         <atlas-button name="drag-handle-{id}" />
 *         <atlas-button name="delete-{id}" />
 *       </atlas-box>
 *       [widget body]
 *     </div>
 *     // empty:
 *     <atlas-box data-drop-slot data-region="{region}" name="drop-slot-{region}"></atlas-box>
 *   </section>
 *
 * Every cell and drop slot has a unique `name` attribute → unique
 * auto-testid. Playwright selects by testid.
 *
 * Interaction model:
 *
 *   1. CLICK / KEYBOARD "two-tap" flow
 *      - click a cell   → cell selected (data-selected=true); empty slots
 *                         become active (data-active=true)
 *      - click a slot   → editor.move({instanceId, region, index: 0})
 *      - click a chip   → chip selected; next slot click → editor.add
 *      - Escape         → clear selection
 *
 *   2. POINTER DRAG (Pointer Events subsystem, see ../dnd/)
 *      - Cells and palette chips register as DnD sources.
 *      - Drop slots (empty regions) register as DnD targets. Filled
 *        regions register no target, so "slot is occupied" naturally
 *        means "not a drop target" — no error path.
 *      - On drop the commit boundary calls editor.move / editor.add.
 *
 *   The native HTML5 Drag and Drop API is NOT used anywhere. See
 *   packages/page-templates/src/dnd/ for the Pointer Events subsystem.
 */

import { EditorController } from './editor-controller.js';
import { EditorAPI, freshInstanceId } from './editor-api.js';
import { createAnnouncer } from './a11y.js';
import { DndController } from '../dnd/controller.js';
import { ensureDndStyles } from '../dnd/styles.js';
import { registerTestState, makeCommit } from '@atlas/test-state';

/**
 * @param {object} options
 * @param {HTMLElement} options.contentPageEl
 * @param {HTMLElement} options.templateEl
 * @param {HTMLElement} options.widgetHostEl
 * @param {object} options.pageDoc
 * @param {object} options.templateManifest
 * @param {object} options.widgetRegistry
 * @param {(nextDoc: object, info: object) => Promise<void>} options.onCommit
 * @param {(payload: object) => void} [options.onTelemetry]
 */
export function attachEditor({
  contentPageEl,
  templateEl: _templateEl,
  widgetHostEl,
  pageDoc,
  templateManifest,
  widgetRegistry,
  onCommit,
  onTelemetry,
  editorId,
}) {
  const controller = new EditorController({
    pageDoc,
    templateManifest,
    widgetRegistry,
  });
  const announcer = createAnnouncer(contentPageEl);
  const telemetry = typeof onTelemetry === 'function' ? onTelemetry : () => {};

  function emitTelemetry(event, payload) {
    telemetry({ event, payload });
  }

  const resolvedEditorId =
    editorId
    ?? pageDoc?.pageId
    ?? contentPageEl.getAttribute?.('data-page-id')
    ?? 'content-page';
  const surfaceKey = `editor:${resolvedEditorId}`;

  const api = new EditorAPI({
    controller,
    onCommit,
    onTelemetry: emitTelemetry,
    announce: (msg) => announcer.announce(msg),
    surfaceId: surfaceKey,
  });

  /** @type {Array<() => void>} */
  const teardowns = [];

  // Expose the editor's committed state to Playwright (dev-only).
  const disposeTestState = registerTestState(surfaceKey, () => api.getSnapshot());
  teardowns.push(disposeTestState);

  ensureDndStyles(contentPageEl);

  const dndController = new DndController({
    root: typeof document !== 'undefined' ? document : undefined,
    activationDistance: 4,
    onDrop: async ({ payload, target }) => commitDndDrop(payload, target),
  });
  dndController.attach();
  teardowns.push(() => dndController.detach());

  // Expose the DnD session state so Playwright can assert mid-drag
  // (active payload + hovered slot) before the drop lands.
  const disposeDragState = registerTestState('drag:layout', () => {
    const active = dndController._active;
    if (!active) return { active: false, payload: null, hoveredSlotId: null };
    return {
      active: true,
      payload: active.source?.getPayload?.() ?? null,
      hoveredSlotId: active.target?.id ?? null,
    };
  });
  teardowns.push(disposeDragState);

  // ---------------------------------------------------------------------
  // Transient selection state (for two-tap flow).
  //   { kind: 'cell', instanceId }  — picked cell, waiting for slot click
  //   { kind: 'chip', widgetId   }  — picked chip, waiting for slot click
  //   null                          — idle
  // ---------------------------------------------------------------------

  /** @type {{kind:'cell',instanceId:string}|{kind:'chip',widgetId:string}|null} */
  let selection = null;

  function setSelection(next) {
    selection = next;
    if (next) {
      contentPageEl.setAttribute(
        'data-editor-selected',
        `${next.kind}:${next.kind === 'cell' ? next.instanceId : next.widgetId}`,
      );
    } else {
      contentPageEl.removeAttribute('data-editor-selected');
    }
    refreshSelectionDecorations();
  }

  function clearSelection() {
    if (!selection) return;
    setSelection(null);
  }

  function refreshSelectionDecorations() {
    for (const cell of widgetHostEl.querySelectorAll('[data-widget-cell]')) {
      cell.removeAttribute('data-selected');
    }
    for (const slot of widgetHostEl.querySelectorAll('section[data-editor-slot]')) {
      slot.removeAttribute('data-active');
      slot.removeAttribute('data-invalid');
    }
    for (const chip of contentPageEl.querySelectorAll('[data-palette-chip]')) {
      chip.removeAttribute('data-selected');
    }
    if (!selection) return;

    if (selection.kind === 'cell') {
      const cellEl = widgetHostEl.querySelector(
        `[data-widget-cell][data-instance-id="${selection.instanceId}"]`,
      );
      if (cellEl) cellEl.setAttribute('data-selected', 'true');
      const found = controller.findInstance(selection.instanceId);
      const valid = found
        ? controller.validTargetsFor(found.entry.widgetId, {
            regionName: found.region,
            index: found.index,
          })
        : null;
      markSlotValidity(valid);
    } else if (selection.kind === 'chip') {
      const chipEl = contentPageEl.querySelector(
        `[data-palette-chip][data-widget-id="${selection.widgetId}"]`,
      );
      if (chipEl) chipEl.setAttribute('data-selected', 'true');
      const valid = controller.validTargetsFor(selection.widgetId, null);
      markSlotValidity(valid);
    }
  }

  function markSlotValidity(validTargets) {
    if (!validTargets) return;
    // Only EMPTY slots are real drop targets; filled slots don't get the
    // active/invalid marker (their cells render normally).
    for (const slot of widgetHostEl.querySelectorAll(
      'section[data-editor-slot][data-empty="true"]',
    )) {
      const region = slot.getAttribute('data-slot');
      const regionEntry = validTargets.validRegions.find(
        (r) => r.regionName === region,
      );
      if (regionEntry) slot.setAttribute('data-active', 'true');
      else slot.setAttribute('data-invalid', 'true');
    }
  }

  // ---------------------------------------------------------------------
  // DOM rendering: one cell OR one drop slot per region. Rebuilt on every
  // doc change.
  // ---------------------------------------------------------------------

  function regionSections() {
    return Array.from(widgetHostEl.querySelectorAll('section[data-slot]'));
  }

  /** @type {Array<() => void>} */
  let dndRegistrations = [];

  function clearDndRegistrations() {
    for (const un of dndRegistrations) {
      try {
        un();
      } catch {
        /* ignore */
      }
    }
    dndRegistrations = [];
    dndController.setTargets([]);
  }

  function clearEditorDecorations() {
    clearDndRegistrations();
    for (const el of widgetHostEl.querySelectorAll('[data-cell-chrome]')) {
      el.remove?.();
    }
    for (const cell of widgetHostEl.querySelectorAll('[data-widget-cell]')) {
      cell.removeAttribute('tabindex');
      cell.removeAttribute('data-instance-id');
      cell.removeAttribute('data-region');
      cell.removeAttribute('data-cell-index');
      cell.removeAttribute('data-selected');
      cell.removeAttribute('name');
    }
    for (const section of regionSections()) {
      section.removeAttribute('data-editor-slot');
      section.removeAttribute('data-empty');
      section.removeAttribute('data-active');
      section.removeAttribute('data-invalid');
      section.removeAttribute('role');
      section.removeAttribute('tabindex');
      section.removeAttribute('aria-label');
      section.removeAttribute('name');
    }
  }

  function decorate() {
    clearEditorDecorations();
    const doc = controller.doc;
    /** @type {Array<import('../dnd/types.js').DropTarget>} */
    const targets = [];
    for (const section of regionSections()) {
      const region = section.getAttribute('data-slot');
      const entries = doc?.regions?.[region] ?? [];
      const cells = Array.from(
        section.querySelectorAll(':scope > [data-widget-cell]'),
      );

      for (let i = 0; i < cells.length; i++) {
        decorateCell(cells[i], region, i, entries[i]);
      }

      // The section IS the slot. It renders with a fixed footprint whether
      // it holds a widget or not, so moving widgets in/out never shifts
      // other slots. Only empty slots register as drop targets.
      section.setAttribute('data-editor-slot', region);
      section.setAttribute('name', `drop-slot-${region}`);

      if (entries.length === 0) {
        section.setAttribute('data-empty', 'true');
        section.setAttribute('role', 'button');
        section.setAttribute('tabindex', '0');
        section.setAttribute('aria-label', `Drop into ${region}`);
        targets.push({
          element: section,
          id: `slot-${region}`,
          containerId: region,
          accepts: (payload) =>
            payload?.type === 'cell' || payload?.type === 'chip',
        });
      }
    }
    dndController.setTargets(targets);
  }

  // Delegated click + keyboard handlers for empty slots. One set of
  // listeners for the lifetime of this attach — no per-decorate rebuild.
  function onHostClick(ev) {
    const section = ev.target?.closest?.('section[data-slot][data-empty="true"]');
    if (!section || !widgetHostEl.contains(section)) return;
    const region = section.getAttribute('data-slot');
    if (!region) return;
    ev.stopPropagation();
    onSlotActivated(region);
  }
  function onHostKeydown(ev) {
    if (ev.target?.tagName !== 'SECTION') return;
    const section = ev.target;
    if (!section.hasAttribute('data-empty')) return;
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      const region = section.getAttribute('data-slot');
      if (region) onSlotActivated(region);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      clearSelection();
    }
  }
  widgetHostEl.addEventListener('click', onHostClick);
  widgetHostEl.addEventListener('keydown', onHostKeydown);
  teardowns.push(() => {
    widgetHostEl.removeEventListener('click', onHostClick);
    widgetHostEl.removeEventListener('keydown', onHostKeydown);
  });

  function decorateCell(cellEl, region, index, entry) {
    const instanceId = entry?.instanceId ?? `cell-${region}-${index}`;
    cellEl.setAttribute('tabindex', '0');
    cellEl.setAttribute('data-instance-id', instanceId);
    cellEl.setAttribute('data-region', region);
    cellEl.setAttribute('data-cell-index', String(index));
    cellEl.setAttribute('name', `cell-${instanceId}`);

    for (const old of cellEl.querySelectorAll(':scope > [data-cell-chrome]')) {
      old.remove?.();
    }

    const chrome = contentPageEl.ownerDocument.createElement('atlas-box');
    chrome.setAttribute('data-cell-chrome', '');
    chrome.setAttribute('name', `chrome-${instanceId}`);

    const handle = contentPageEl.ownerDocument.createElement('atlas-button');
    handle.setAttribute('name', `drag-handle-${instanceId}`);
    handle.setAttribute('size', 'sm');
    handle.setAttribute('variant', 'ghost');
    handle.setAttribute('aria-label', 'Drag widget');
    handle.setAttribute('tabindex', '-1');
    handle.textContent = '⋮⋮';

    const del = contentPageEl.ownerDocument.createElement('atlas-button');
    del.setAttribute('name', `delete-${instanceId}`);
    del.setAttribute('size', 'sm');
    del.setAttribute('variant', 'danger');
    del.setAttribute('aria-label', 'Delete widget');
    del.textContent = '×';
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const res = await api.remove({ instanceId });
      if (res.ok) {
        announcer.announce(`${findDisplayName(entry?.widgetId)} deleted.`);
      } else {
        announcer.announce(`Cannot delete: ${res.reason}.`);
      }
    });

    chrome.appendChild(handle);
    chrome.appendChild(del);
    cellEl.appendChild(chrome);

    cellEl.addEventListener('click', (ev) => {
      if (ev.target && typeof ev.target.closest === 'function') {
        if (ev.target.closest('[name^="delete-"]')) return;
      }
      ev.stopPropagation();
      toggleCellSelection(instanceId);
    });
    cellEl.addEventListener('keydown', (ev) => {
      if (ev.target !== cellEl) return;
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        toggleCellSelection(instanceId);
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        void api.remove({ instanceId }).then((res) => {
          if (res.ok)
            announcer.announce(`${findDisplayName(entry?.widgetId)} deleted.`);
          else announcer.announce(`Cannot delete: ${res.reason}.`);
        });
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        clearSelection();
      }
    });

    const unreg = dndController.registerSource({
      element: cellEl,
      containerId: region,
      getPayload: () => ({ type: 'cell', id: instanceId }),
    });
    dndRegistrations.push(unreg);
  }

  function toggleCellSelection(instanceId) {
    if (
      selection &&
      selection.kind === 'cell' &&
      selection.instanceId === instanceId
    ) {
      clearSelection();
      return;
    }
    setSelection({ kind: 'cell', instanceId });
    const entry = controller.findInstance(instanceId);
    const label = findDisplayName(entry?.entry?.widgetId);
    announcer.announce(
      `Selected ${label}. Click or press Enter on a drop slot to move it, or press Escape to cancel.`,
    );
  }

  // ---------------------------------------------------------------------
  // Slot activations: click / Enter / pointer-drop all funnel here.
  // ---------------------------------------------------------------------

  async function onSlotActivated(region) {
    if (!selection) {
      announcer.announce('Select a widget or palette item first.');
      return;
    }
    await commitSlot(region);
  }

  /**
   * Called by the DnD subsystem's commit boundary when a pointer-driven
   * drag ends on a registered drop slot.
   *
   * @param {import('../dnd/types.js').DragPayload} payload
   * @param {import('../dnd/types.js').DropTarget} target
   */
  async function commitDndDrop(payload, target) {
    const region = target?.containerId;
    if (!payload || typeof region !== 'string') {
      return { ok: false, reason: 'invalid-target' };
    }
    let res;
    if (payload.type === 'cell') {
      res = await api.move({ instanceId: payload.id, region, index: 0 });
    } else if (payload.type === 'chip') {
      res = await api.add({ widgetId: payload.id, region, index: 0 });
    } else {
      return { ok: false, reason: 'unknown-payload' };
    }
    if (res.ok) {
      // Record a drop intent on top of the underlying add/move so tests
      // can distinguish pointer-driven drops from programmatic moves.
      api.recordExternalCommit('drop', {
        payload: { type: payload.type, id: payload.id },
        toRegion: region,
        underlying: res.action,
        instanceId: res.instanceId,
      });
    }
    announceResult(res, region);
    clearSelection();
    return res;
  }

  async function commitSlot(region) {
    if (!selection) return;
    let res;
    if (selection.kind === 'cell') {
      res = await api.move({
        instanceId: selection.instanceId,
        region,
        index: 0,
      });
    } else {
      res = await api.add({ widgetId: selection.widgetId, region, index: 0 });
    }
    announceResult(res, region);
    clearSelection();
  }

  function announceResult(res, region) {
    if (!res.ok) {
      announcer.announce(`Drop rejected: ${res.reason}.`);
      return;
    }
    if (res.noop) {
      announcer.announce('No change.');
      return;
    }
    const label = findDisplayName(res.widgetId);
    if (res.action === 'move') {
      announcer.announce(`${label} moved to ${region}.`);
    } else if (res.action === 'add') {
      announcer.announce(`${label} added to ${region}.`);
    }
  }

  function findDisplayName(widgetId) {
    try {
      const entry = widgetRegistry.get(widgetId);
      return entry?.manifest?.displayName ?? widgetId ?? 'widget';
    } catch {
      return widgetId ?? 'widget';
    }
  }

  // ---------------------------------------------------------------------
  // Palette hookup.
  // ---------------------------------------------------------------------

  /** @type {Array<() => void>} */
  let paletteDndUnregs = [];

  function clearPaletteDndRegistrations() {
    for (const un of paletteDndUnregs) {
      try {
        un();
      } catch {
        /* ignore */
      }
    }
    paletteDndUnregs = [];
  }

  function registerPaletteChips(paletteEl) {
    clearPaletteDndRegistrations();
    const chips = paletteEl.querySelectorAll('[data-palette-chip]');
    for (const chip of chips) {
      const widgetId = chip.getAttribute('data-widget-id');
      if (!widgetId) continue;
      const unreg = dndController.registerSource({
        element: chip,
        containerId: 'palette',
        getPayload: () => ({ type: 'chip', id: widgetId }),
      });
      paletteDndUnregs.push(unreg);
    }
  }

  function setPalette(paletteEl) {
    paletteEl.onChipSelect = ({ widgetId }) => {
      setSelection({ kind: 'chip', widgetId });
      announcer.announce(
        `Adding ${findDisplayName(widgetId)}. Click or press Enter on a drop slot to place it, or press Escape to cancel.`,
      );
    };
    paletteEl.onChipActivate = async ({ widgetId, region }) => {
      const res = await api.add({ widgetId, region, index: 0 });
      announceResult(res, region);
      clearSelection();
    };
    registerPaletteChips(paletteEl);
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(() => registerPaletteChips(paletteEl));
      mo.observe(paletteEl, { childList: true, subtree: true });
      teardowns.push(() => mo.disconnect());
    }
    teardowns.push(clearPaletteDndRegistrations);
  }

  const onDocKey = (ev) => {
    if (ev.key === 'Escape' && selection) {
      clearSelection();
    }
  };
  contentPageEl.addEventListener('keydown', onDocKey);
  teardowns.push(() => contentPageEl.removeEventListener('keydown', onDocKey));

  decorate();

  function detach() {
    clearSelection();
    clearEditorDecorations();
    for (const fn of teardowns) {
      try {
        fn();
      } catch {
        /* best effort */
      }
    }
    contentPageEl.removeAttribute('data-editor-selected');
    announcer.element.remove?.();
  }

  return {
    controller,
    api,
    announcer,
    setPalette,
    detach,
    // Called by <content-page> after an incremental widget-host mutation
    // so editor chrome (cell decoration + DnD sources + drop-slot
    // registration) re-syncs with the new doc without a full remount.
    refresh: () => decorate(),
    _selectCellForTest(instanceId) {
      setSelection({ kind: 'cell', instanceId });
    },
  };
}

export { freshInstanceId };
