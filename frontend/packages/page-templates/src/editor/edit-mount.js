/**
 * edit-mount.js — attaches editor chrome (cell chrome, hover drop targets,
 * palette, announcer) to a <content-page> after its widget-host has mounted
 * in view mode.
 *
 * Drop model: widget-anchored. Every non-source widget cell offers two
 * virtual halves while a drag is active — top = "insert before this widget",
 * bottom = "insert after this widget". The pointer's position in the cell
 * decides which half lights up. Empty regions get a single rectangular
 * drop zone. There are no persistent drop bars in the document flow and
 * no [data-drop-indicator] elements anywhere — edit mode preserves
 * view-mode layout.
 *
 * Editor decorations attached to widget-host children:
 *   - [data-cell-chrome] overlay (drag handle + delete) per cell
 *   - [data-drop-empty] marker in otherwise-empty sections during pickup
 * All are removed in detach(). The cell half-highlights are CSS pseudo
 * elements driven by [data-drop-target] on the cell itself — no DOM added.
 */

import { EditorController } from './editor-controller.js';
import { createAnnouncer } from './a11y.js';

/**
 * Attach the editor to a content-page. Returns a teardown function.
 *
 * @param {object} options
 * @param {HTMLElement} options.contentPageEl — the <content-page>
 * @param {HTMLElement} options.templateEl — the mounted template element
 * @param {HTMLElement} options.widgetHostEl — the mounted <widget-host>
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
}) {
  const controller = new EditorController({
    pageDoc,
    templateManifest,
    widgetRegistry,
  });
  const announcer = createAnnouncer(contentPageEl);
  const telemetry = typeof onTelemetry === 'function' ? onTelemetry : () => {};

  /** @type {HTMLElement | null} */
  let toastEl = null;
  /** @type {number | null} */
  let toastTimer = null;
  function toast(message, variant = 'info') {
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    toastEl = contentPageEl.ownerDocument.createElement('atlas-box');
    toastEl.setAttribute('data-editor-toast', '');
    toastEl.setAttribute('data-variant', variant);
    toastEl.setAttribute('name', 'editor-toast');
    toastEl.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    toastEl.textContent = String(message);
    contentPageEl.appendChild(toastEl);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
      toastEl = null;
      toastTimer = null;
    }, 3000);
  }

  /** @type {Array<() => void>} */
  const teardowns = [];
  /** @type {HTMLElement | null} */
  let ghostEl = null;

  // --- helpers ---------------------------------------------------------

  function regionSections() {
    return Array.from(widgetHostEl.querySelectorAll('section[data-slot]'));
  }

  function cellsIn(section) {
    return Array.from(section.querySelectorAll(':scope > [data-widget-cell]'));
  }

  function allCells() {
    return Array.from(widgetHostEl.querySelectorAll('[data-widget-cell]'));
  }

  function findDisplayName(widgetId) {
    try {
      const entry = widgetRegistry.get(widgetId);
      return entry?.manifest?.displayName ?? widgetId;
    } catch {
      return widgetId;
    }
  }

  function cellLabel(cell) {
    const regionName = cell.getAttribute('data-region');
    const idx = parseInt(cell.getAttribute('data-cell-index') ?? '-1', 10);
    const entries = controller.doc.regions?.[regionName] ?? [];
    const entry = entries[idx];
    return entry ? findDisplayName(entry.widgetId) : 'widget';
  }

  function clearAllDropHighlights() {
    for (const cell of allCells()) {
      cell.removeAttribute('data-drop-target');
      cell.removeAttribute('data-drop-invalid');
    }
    for (const empty of widgetHostEl.querySelectorAll('[data-drop-empty]')) {
      empty.removeAttribute('data-hover');
    }
  }

  function clearEmptyZones() {
    for (const empty of widgetHostEl.querySelectorAll('[data-drop-empty]')) {
      empty.remove?.();
    }
  }

  /**
   * While a drag is active, any region that looks visually empty (either
   * has no cells at all, or only the hidden source cell remains) gets a
   * single "Drop here" rectangle. The rectangle's [data-drop-valid] tells
   * the author whether the current picked widget is actually allowed there.
   */
  function renderEmptyZones() {
    clearEmptyZones();
    const valid = controller.getValidTargets();
    if (!valid) return;
    const picked = controller.picked;
    const sourceSameRegion =
      picked && picked.source && typeof picked.source === 'object'
        ? picked.source.regionName
        : null;

    for (const section of regionSections()) {
      const regionName = section.getAttribute('data-slot');
      const cells = cellsIn(section);
      // "Visually empty" = no cells, OR the only cell is the source (hidden).
      const visiblyEmpty =
        cells.length === 0 ||
        (cells.length === 1 &&
          sourceSameRegion === regionName &&
          cells[0].getAttribute('data-picked') === 'true');
      if (!visiblyEmpty) continue;

      const regionEntry = valid.validRegions.find((r) => r.regionName === regionName);
      const invalidEntry = valid.invalidRegions.find((r) => r.regionName === regionName);
      const isValid =
        regionEntry &&
        Array.isArray(regionEntry.canInsertAt) &&
        regionEntry.canInsertAt.some((v) => v === true);

      const zone = contentPageEl.ownerDocument.createElement('atlas-box');
      zone.setAttribute('data-drop-empty', '');
      zone.setAttribute('data-region', regionName);
      zone.setAttribute('name', 'drop-empty');
      zone.setAttribute('data-drop-valid', isValid ? 'true' : 'false');
      zone.setAttribute(
        'aria-label',
        isValid
          ? `Drop into ${regionName}`
          : `Cannot drop into ${regionName}: ${invalidEntry?.reason ?? regionEntry?.reason ?? 'not permitted'}`,
      );
      zone.textContent = isValid
        ? `Drop here — ${regionName}`
        : `Cannot drop into ${regionName}`;
      section.appendChild(zone);
    }
  }

  function markPickedCell(cellEl, picked) {
    for (const c of allCells()) {
      c.removeAttribute('data-picked');
    }
    if (picked && cellEl) {
      cellEl.setAttribute('data-picked', 'true');
    }
  }

  function removeGhost() {
    if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
    ghostEl = null;
  }

  function createGhost(label, x, y) {
    removeGhost();
    const el = contentPageEl.ownerDocument.createElement('atlas-box');
    el.setAttribute('data-drag-ghost', '');
    el.setAttribute('name', 'drag-ghost');
    el.setAttribute('aria-hidden', 'true');
    el.textContent = label;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    contentPageEl.appendChild(el);
    ghostEl = el;
  }

  // --- commit path -----------------------------------------------------

  async function commit(result) {
    if (!result || !result.ok) return false;
    try {
      await onCommit(result.nextDoc, {
        action: result.action,
        widgetId: result.widgetId,
        from: result.from,
        to: result.to,
      });
      const widgetLabel = findDisplayName(result.widgetId);
      if (result.action === 'move') {
        const anchor = result.anchorLabel;
        const side = result.anchorSide;
        if (anchor && side) {
          announcer.announce(`${widgetLabel} moved ${side} ${anchor}.`);
        } else {
          announcer.announce(
            `${widgetLabel} moved to ${result.to.regionName} position ${result.to.index + 1}.`,
          );
        }
      } else if (result.action === 'add') {
        announcer.announce(
          `${widgetLabel} added to ${result.to.regionName} position ${result.to.index + 1}.`,
        );
      } else if (result.action === 'delete') {
        announcer.announce(`${widgetLabel} deleted.`);
      }
      telemetry({
        event: 'atlas.content-page.edit',
        payload: {
          action: result.action,
          widgetId: result.widgetId,
          fromRegion: result.from?.regionName,
          fromIndex: result.from?.index,
          toRegion: result.to?.regionName,
          toIndex: result.to?.index,
        },
      });
      return true;
    } catch (err) {
      const msg = err?.message ?? String(err);
      announcer.announce(`Save failed: ${msg}`);
      telemetry({
        event: 'atlas.content-page.save.error',
        payload: { message: msg },
      });
      return false;
    }
  }

  // --- decorate each cell with chrome ---------------------------------

  function decorate() {
    for (const section of regionSections()) {
      const regionName = section.getAttribute('data-slot');
      const cells = cellsIn(section);
      for (let i = 0; i < cells.length; i++) {
        decorateCell(cells[i], regionName, i);
      }
    }
  }

  function decorateCell(cell, regionName, index) {
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('data-region', regionName);
    cell.setAttribute('data-cell-index', String(index));

    const chrome = contentPageEl.ownerDocument.createElement('atlas-box');
    chrome.setAttribute('data-cell-chrome', '');
    chrome.setAttribute('name', 'cell-chrome');

    // Drag handle is a visual affordance only. The whole cell is grabbable
    // (see the cell-level pointerdown below), so pointerdown on the handle
    // simply bubbles to the cell's listener.
    const handle = contentPageEl.ownerDocument.createElement('atlas-button');
    handle.setAttribute('name', 'drag-handle');
    handle.setAttribute('size', 'sm');
    handle.setAttribute('variant', 'ghost');
    handle.setAttribute('aria-label', 'Drag widget');
    handle.setAttribute('tabindex', '-1');
    handle.textContent = '\u22ee\u22ee';

    const del = contentPageEl.ownerDocument.createElement('atlas-button');
    del.setAttribute('name', 'delete-button');
    del.setAttribute('size', 'sm');
    del.setAttribute('variant', 'danger');
    del.setAttribute('aria-label', 'Delete widget');
    del.textContent = '\u00d7';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handleDelete(regionName, index);
    });

    chrome.appendChild(handle);
    chrome.appendChild(del);
    cell.appendChild(chrome);

    // Whole-cell grab: pointerdown anywhere in the cell starts the drag,
    // except over the delete button. Widget bodies are pointer-events:none
    // in edit mode so their content can't swallow the pointerdown.
    cell.addEventListener('pointerdown', (ev) => {
      // Only left-button presses initiate a drag.
      if (typeof ev.button === 'number' && ev.button !== 0) return;
      // Ignore if a drag is already active (prevents double-pickup).
      if (controller.picked) return;
      // Let the delete button keep its own click semantics.
      const overDelete =
        ev.target &&
        typeof ev.target.closest === 'function' &&
        ev.target.closest('[data-testid="content-page.delete-button"], atlas-button[name="delete-button"]');
      if (overDelete) return;
      ev.preventDefault();
      startPointerDrag(cell, regionName, index, ev);
    });

    cell.addEventListener('keydown', (ev) => {
      if (ev.target !== cell) return;
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        if (controller.picked) {
          // Drop onto this cell's "before" half by default when keyboard-
          // committing. Authors can use arrow keys to pick before/after.
          const side = cell.getAttribute('data-drop-target') === 'after' ? 'after' : 'before';
          commitKeyboardDrop(cell, side);
        } else {
          handlePickUp(cell, regionName, index, 'keyboard');
        }
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        if (!controller.picked) handleDelete(regionName, index);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        handleCancel();
      } else if (
        controller.picked &&
        (ev.key === 'ArrowUp' ||
          ev.key === 'ArrowDown' ||
          ev.key === 'ArrowLeft' ||
          ev.key === 'ArrowRight')
      ) {
        ev.preventDefault();
        keyboardNavigateHalves(cell, ev.key);
      } else if (controller.picked && ev.key === 'Tab') {
        ev.preventDefault();
        toggleHalf(cell);
      }
    });
  }

  // --- pickup / cancel / delete ---------------------------------------

  /** @type {null | (() => void)} */
  let _pointerSessionTeardown = null;

  function handlePickUp(cellEl, regionName, index, via) {
    const entries = controller.doc.regions?.[regionName] ?? [];
    const entry = entries[index];
    if (!entry) return;
    controller.pickUp({
      widgetId: entry.widgetId,
      source: { regionName, index },
      via,
    });
    markPickedCell(cellEl, true);
    contentPageEl.setAttribute('data-editor-active', 'true');
    renderEmptyZones();
    announcer.announce(
      `Picked up ${findDisplayName(entry.widgetId)}. Hover a widget and drop on its top or bottom half, or press Escape to cancel.`,
    );
    if (via === 'pointer') installPointerSession({ commitOnUp: true });
    if (via === 'keyboard') focusFirstValidCell();
  }

  function handlePaletteUp({ widgetId, via }) {
    controller.pickUp({ widgetId, source: 'palette', via });
    contentPageEl.setAttribute('data-editor-active', 'true');
    renderEmptyZones();
    const label = findDisplayName(widgetId);
    announcer.announce(`Adding ${label}. Hover a widget and drop on its top or bottom half, or press Escape to cancel.`);
    toast(`Adding ${label} — drop on a widget's top or bottom half, or on an empty region.`);
    // Palette pickup uses a latched pointer: follow the cursor, commit on
    // the NEXT pointerup (not the palette chip's own up, which Playwright /
    // users already released). Passing commitOnUp:false means a move is
    // committed via click-to-confirm — a follow-up pointerdown + up.
    if (via === 'pointer') installPointerSession({ commitOnUp: false });
    if (via === 'keyboard') focusFirstValidCell();
  }

  function handleCancel() {
    if (_pointerSessionTeardown) {
      _pointerSessionTeardown();
      _pointerSessionTeardown = null;
    }
    if (!controller.picked) return;
    controller.cancel();
    removeGhost();
    markPickedCell(null, false);
    contentPageEl.setAttribute('data-editor-active', 'false');
    clearAllDropHighlights();
    clearEmptyZones();
    announcer.announce('Move cancelled.');
  }

  function handleDelete(regionName, index) {
    const result = controller.deleteInstance({ regionName, index });
    if (!result.ok) {
      const msg = `Delete failed: ${result.reason}`;
      announcer.announce(msg);
      toast(msg, 'error');
      return;
    }
    void commit(result);
  }

  // --- drop dispatch --------------------------------------------------

  /**
   * Translate an "anchored" drop (before/after a cell, or into an empty
   * region) into a {regionName, insertIndex} pair and dispatch through the
   * controller. Filters out moves that resolve to the source's current
   * position — no pointless commit/remount.
   */
  function handleDropAnchored({ regionName, anchorIndex, side, anchorCell }) {
    const picked = controller.picked;
    if (!picked) return;

    let insertIndex;
    if (anchorIndex == null) {
      insertIndex = 0; // empty-region drop
    } else {
      insertIndex = side === 'before' ? anchorIndex : anchorIndex + 1;
    }

    // Within-region move: detect the no-op case (drop adjacent to self)
    // before invoking the controller. EditorController.drop() would
    // otherwise accept it and emit a pointless save.
    if (picked.source && typeof picked.source === 'object') {
      const src = picked.source;
      if (src.regionName === regionName) {
        const adjusted = src.index < insertIndex ? insertIndex - 1 : insertIndex;
        if (adjusted === src.index) {
          // No structural change — treat as cancel.
          handleCancel();
          return;
        }
      }
    }

    let result;
    if (picked.source === 'palette') {
      const entry = {
        widgetId: picked.widgetId,
        instanceId: freshInstanceId(picked.widgetId),
        config: {},
      };
      result = controller.addFromPalette({ entry, target: { regionName, index: insertIndex } });
    } else {
      result = controller.drop({ target: { regionName, index: insertIndex } });
    }
    if (!result.ok) {
      announcer.announce(`Drop rejected: ${result.reason}`);
      toast(`Drop rejected: ${result.reason}`, 'error');
      return;
    }
    // Decorate the result with anchor-aware labels for the announcer.
    if (result.action === 'move' && anchorCell) {
      result.anchorLabel = cellLabel(anchorCell);
      result.anchorSide = side;
    }
    removeGhost();
    markPickedCell(null, false);
    clearAllDropHighlights();
    clearEmptyZones();
    contentPageEl.setAttribute('data-editor-active', 'false');
    void commit(result);
  }

  // --- pointer drag ---------------------------------------------------

  /**
   * Pierce shadow DOM when hit-testing. `document.elementFromPoint` stops
   * at the first shadow host; recurse into each host's shadow root until
   * we reach a node with no further shadowRoot.
   */
  function deepElementFromPoint(x, y) {
    const doc = contentPageEl.ownerDocument;
    if (typeof doc?.elementFromPoint !== 'function') return null;
    let el = doc.elementFromPoint(x, y);
    while (el && el.shadowRoot && typeof el.shadowRoot.elementFromPoint === 'function') {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function isRegionValidFor(regionName) {
    const valid = controller.getValidTargets();
    if (!valid) return false;
    const entry = valid.validRegions.find((r) => r.regionName === regionName);
    return !!entry && Array.isArray(entry.canInsertAt) && entry.canInsertAt.some((v) => v === true);
  }

  function updateHoverForPoint(x, y) {
    const under = deepElementFromPoint(x, y);
    // Which target (cell or empty-zone) is the pointer over?
    const overCell =
      under &&
      typeof under.closest === 'function' &&
      under.closest('[data-widget-cell]');
    const overEmpty =
      under &&
      typeof under.closest === 'function' &&
      under.closest('[data-drop-empty]');

    clearAllDropHighlights();

    // Source cell is hidden (display:none), so the pointer can never be
    // over it — no special-case needed.
    if (overCell && overCell.getAttribute('data-picked') !== 'true') {
      const regionName = overCell.getAttribute('data-region');
      const regionValid = isRegionValidFor(regionName);
      const rect = overCell.getBoundingClientRect?.();
      if (rect) {
        const mid = rect.top + rect.height / 2;
        const side = y < mid ? 'before' : 'after';
        overCell.setAttribute('data-drop-target', side);
        if (!regionValid) overCell.setAttribute('data-drop-invalid', 'true');
      }
    } else if (overEmpty) {
      overEmpty.setAttribute('data-hover', 'true');
    }
  }

  function readPointerTarget(x, y) {
    const under = deepElementFromPoint(x, y);
    const overCell =
      under &&
      typeof under.closest === 'function' &&
      under.closest('[data-widget-cell]');
    const overEmpty =
      under &&
      typeof under.closest === 'function' &&
      under.closest('[data-drop-empty]');

    if (overCell && overCell.getAttribute('data-picked') !== 'true') {
      const regionName = overCell.getAttribute('data-region');
      const anchorIndex = parseInt(overCell.getAttribute('data-cell-index') ?? '-1', 10);
      const rect = overCell.getBoundingClientRect?.();
      if (!rect || anchorIndex < 0) return null;
      const mid = rect.top + rect.height / 2;
      const side = y < mid ? 'before' : 'after';
      return { kind: 'cell', regionName, anchorIndex, side, anchorCell: overCell };
    }
    if (overEmpty) {
      const regionName = overEmpty.getAttribute('data-region');
      if (overEmpty.getAttribute('data-drop-valid') !== 'true') return null;
      return { kind: 'empty', regionName };
    }
    return null;
  }

  function startPointerDrag(cell, regionName, index, ev) {
    handlePickUp(cell, regionName, index, 'pointer');
    const label = findDisplayName(controller.picked?.widgetId ?? '');
    createGhost(label, ev.clientX ?? 0, ev.clientY ?? 0);
  }

  /**
   * Install window-level pointermove + pointerup handlers to drive hover
   * highlights and drop commits. Shared by the drag-handle flow (pickup
   * inside a pointerdown) and the palette flow (pickup via click — no
   * pressed button; commit on the user's next pointerup).
   */
  function installPointerSession(_opts = {}) {
    // Replace any prior session (e.g. palette → drag-handle).
    if (_pointerSessionTeardown) {
      _pointerSessionTeardown();
      _pointerSessionTeardown = null;
    }

    const win = contentPageEl.ownerDocument?.defaultView ?? window;

    // If pickup didn't create a ghost yet (palette flow), make one now
    // so the cursor has feedback as soon as the user starts moving.
    if (!ghostEl && controller.picked) {
      const label = findDisplayName(controller.picked.widgetId);
      createGhost(label, -1000, -1000);
    }

    const onMove = (mv) => {
      if (ghostEl) {
        ghostEl.style.left = `${mv.clientX ?? 0}px`;
        ghostEl.style.top = `${mv.clientY ?? 0}px`;
      }
      updateHoverForPoint(mv.clientX ?? 0, mv.clientY ?? 0);
    };
    const onUp = (uv) => {
      teardown();
      const target = readPointerTarget(uv?.clientX ?? 0, uv?.clientY ?? 0);
      if (!target) {
        handleCancel();
        return;
      }
      if (target.kind === 'cell') {
        handleDropAnchored({
          regionName: target.regionName,
          anchorIndex: target.anchorIndex,
          side: target.side,
          anchorCell: target.anchorCell,
        });
      } else if (target.kind === 'empty') {
        handleDropAnchored({
          regionName: target.regionName,
          anchorIndex: null,
          side: null,
          anchorCell: null,
        });
      }
    };

    function teardown() {
      win.removeEventListener('pointermove', onMove, true);
      win.removeEventListener('pointerup', onUp, true);
      win.removeEventListener('pointercancel', onUp, true);
      _pointerSessionTeardown = null;
    }

    win.addEventListener('pointermove', onMove, true);
    win.addEventListener('pointerup', onUp, true);
    win.addEventListener('pointercancel', onUp, true);
    _pointerSessionTeardown = teardown;
  }

  // --- keyboard path --------------------------------------------------

  /**
   * Return the list of cells that are valid anchors for the currently
   * picked widget, ordered by (region, index). Excludes the source cell.
   */
  function validAnchorCells() {
    const valid = controller.getValidTargets();
    if (!valid) return [];
    const picked = controller.picked;
    const sourceRegion =
      picked && picked.source && typeof picked.source === 'object'
        ? picked.source.regionName
        : null;
    const sourceIndex =
      picked && picked.source && typeof picked.source === 'object'
        ? picked.source.index
        : -1;

    const out = [];
    for (const section of regionSections()) {
      const regionName = section.getAttribute('data-slot');
      if (!isRegionValidFor(regionName)) continue;
      const cells = cellsIn(section);
      for (let i = 0; i < cells.length; i++) {
        if (regionName === sourceRegion && i === sourceIndex) continue;
        out.push(cells[i]);
      }
    }
    return out;
  }

  function focusFirstValidCell() {
    const anchors = validAnchorCells();
    const first = anchors[0];
    if (!first) return;
    first.setAttribute('data-drop-target', 'before');
    try {
      first.focus?.();
    } catch {
      /* linkedom doesn't always implement focus */
    }
  }

  function keyboardNavigateHalves(cell, key) {
    const anchors = validAnchorCells();
    const idx = anchors.indexOf(cell);
    const currentSide = cell.getAttribute('data-drop-target') ?? 'before';
    clearAllDropHighlights();

    let nextCell = cell;
    let nextSide = currentSide;
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      if (currentSide === 'after') {
        nextSide = 'before';
      } else {
        const prev = anchors[(idx - 1 + anchors.length) % anchors.length];
        nextCell = prev ?? cell;
        nextSide = 'after';
      }
    } else {
      if (currentSide === 'before') {
        nextSide = 'after';
      } else {
        const next = anchors[(idx + 1) % anchors.length];
        nextCell = next ?? cell;
        nextSide = 'before';
      }
    }
    nextCell.setAttribute('data-drop-target', nextSide);
    try {
      nextCell.focus?.();
    } catch {
      /* ignore */
    }
    announcer.announce(`Drop ${nextSide} ${cellLabel(nextCell)}.`);
  }

  function toggleHalf(cell) {
    const currentSide = cell.getAttribute('data-drop-target') ?? 'before';
    const nextSide = currentSide === 'before' ? 'after' : 'before';
    clearAllDropHighlights();
    cell.setAttribute('data-drop-target', nextSide);
    announcer.announce(`Drop ${nextSide} ${cellLabel(cell)}.`);
  }

  function commitKeyboardDrop(cell, side) {
    const regionName = cell.getAttribute('data-region');
    const anchorIndex = parseInt(cell.getAttribute('data-cell-index') ?? '-1', 10);
    if (!regionName || anchorIndex < 0) return;
    handleDropAnchored({ regionName, anchorIndex, side, anchorCell: cell });
  }

  function freshInstanceId(widgetId) {
    const rand = Math.random().toString(36).slice(2, 8);
    const prefix = String(widgetId).split('.').pop() || 'w';
    return `w-${prefix}-${Date.now().toString(36)}-${rand}`;
  }

  // --- palette wiring (set by caller) ----------------------------------

  function setPalette(paletteEl) {
    paletteEl.onPickUp = ({ widgetId, via }) => handlePaletteUp({ widgetId, via });
  }

  // --- global keydown for Escape (works anywhere in the page) ----------

  const onGlobalKey = (ev) => {
    if (ev.key === 'Escape' && controller.picked) {
      handleCancel();
    }
  };
  contentPageEl.addEventListener('keydown', onGlobalKey);
  teardowns.push(() => contentPageEl.removeEventListener('keydown', onGlobalKey));

  decorate();

  // --- teardown --------------------------------------------------------

  function detach() {
    if (_pointerSessionTeardown) {
      _pointerSessionTeardown();
      _pointerSessionTeardown = null;
    }
    removeGhost();
    clearEmptyZones();
    clearAllDropHighlights();
    if (toastTimer) clearTimeout(toastTimer);
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    toastEl = null;
    toastTimer = null;
    for (const fn of teardowns) {
      try {
        fn();
      } catch {
        /* best effort */
      }
    }
    for (const chrome of widgetHostEl.querySelectorAll('[data-cell-chrome]')) {
      chrome.remove?.();
    }
    for (const cell of widgetHostEl.querySelectorAll('[data-widget-cell][tabindex]')) {
      cell.removeAttribute('tabindex');
      cell.removeAttribute('data-picked');
      cell.removeAttribute('data-region');
      cell.removeAttribute('data-cell-index');
      cell.removeAttribute('data-drop-target');
      cell.removeAttribute('data-drop-invalid');
    }
    contentPageEl.removeAttribute('data-editor-active');
    announcer.element.remove?.();
  }

  return {
    controller,
    announcer,
    setPalette,
    detach,
  };
}
