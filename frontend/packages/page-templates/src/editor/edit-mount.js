/**
 * edit-mount.js — attaches editor chrome (cell overlays, drop indicators,
 * palette, announcer) to a <content-page> after its widget-host has mounted
 * in view mode. Pulled out of content-page-element.js so view-mode stays
 * compact.
 *
 * The editor does NOT mutate widget-host DOM except to ADD decoration
 * children: cell chrome overlays and drop indicators. The underlying
 * widget-host markup (`section[data-slot]`, `[data-widget-cell]`) is read-only.
 *
 * Pointer + keyboard paths share the same controller/state machine.
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

  // Visible toast for sighted users; complements the SR-only announcer.
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

  function findDisplayName(widgetId) {
    try {
      const entry = widgetRegistry.get(widgetId);
      return entry?.manifest?.displayName ?? widgetId;
    } catch {
      return widgetId;
    }
  }

  function getIndicators() {
    return Array.from(widgetHostEl.querySelectorAll('[data-drop-indicator]'));
  }

  function updateIndicatorValidity() {
    const valid = controller.getValidTargets();
    contentPageEl.setAttribute('data-editor-active', valid ? 'true' : 'false');
    for (const ind of getIndicators()) {
      const region = ind.getAttribute('data-region');
      const idx = parseInt(ind.getAttribute('data-index') ?? '-1', 10);
      if (!valid) {
        ind.removeAttribute('data-valid');
        continue;
      }
      const regionEntry = valid.validRegions.find((r) => r.regionName === region);
      const isValid =
        regionEntry &&
        Array.isArray(regionEntry.canInsertAt) &&
        regionEntry.canInsertAt[idx] === true;
      ind.setAttribute('data-valid', isValid ? 'true' : 'false');
    }
  }

  function markPickedCell(cellEl, picked) {
    for (const c of widgetHostEl.querySelectorAll('[data-widget-cell]')) {
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
        announcer.announce(
          `${widgetLabel} moved to ${result.to.regionName} position ${result.to.index + 1}.`,
        );
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

  // --- decorate each cell with chrome + indicators ---------------------

  function decorate() {
    for (const section of regionSections()) {
      const regionName = section.getAttribute('data-slot');
      const cells = cellsIn(section);

      // Insert an indicator BEFORE each cell + one AFTER the last.
      for (let i = 0; i <= cells.length; i++) {
        const ind = contentPageEl.ownerDocument.createElement('atlas-box');
        ind.setAttribute('data-drop-indicator', '');
        ind.setAttribute('data-region', regionName);
        ind.setAttribute('data-index', String(i));
        ind.setAttribute('name', 'drop-indicator');
        ind.setAttribute('tabindex', '-1'); // focusable programmatically
        ind.setAttribute('role', 'button');
        ind.setAttribute('aria-label', `Drop zone ${regionName} position ${i + 1}`);
        // Pointer path.
        ind.addEventListener('pointerup', (ev) => {
          ev.stopPropagation();
          handleDropAt({ regionName, index: i });
        });
        ind.addEventListener('pointerenter', () => updateIndicatorValidity());
        // Keyboard path.
        ind.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
            ev.preventDefault();
            handleDropAt({ regionName, index: i });
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            handleCancel();
          } else if (
            ev.key === 'ArrowLeft' ||
            ev.key === 'ArrowRight' ||
            ev.key === 'ArrowUp' ||
            ev.key === 'ArrowDown'
          ) {
            ev.preventDefault();
            moveIndicatorFocus(ind, ev.key);
          }
        });
        if (i < cells.length) {
          section.insertBefore(ind, cells[i]);
        } else {
          section.appendChild(ind);
        }
      }

      // Chrome on each cell.
      for (let i = 0; i < cells.length; i++) {
        decorateCell(cells[i], regionName, i);
      }
    }
  }

  function decorateCell(cell, regionName, index) {
    cell.setAttribute('tabindex', '0');

    // Chrome overlay: drag handle + delete button.
    const chrome = contentPageEl.ownerDocument.createElement('atlas-box');
    chrome.setAttribute('data-cell-chrome', '');
    chrome.setAttribute('name', 'cell-chrome');

    const handle = contentPageEl.ownerDocument.createElement('atlas-button');
    handle.setAttribute('name', 'drag-handle');
    handle.setAttribute('size', 'sm');
    handle.setAttribute('variant', 'ghost');
    handle.setAttribute('aria-label', 'Drag widget');
    handle.textContent = '\u22ee\u22ee'; // double vertical ellipsis
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      startPointerDrag(cell, regionName, index, ev);
    });

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

    cell.addEventListener('keydown', (ev) => {
      // Only handle keys when the cell itself is focused — avoid stealing
      // keys from elements inside.
      if (ev.target !== cell) return;
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        handlePickUp(cell, regionName, index, 'keyboard');
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        handleDelete(regionName, index);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        handleCancel();
      }
    });
  }

  // --- command handlers ------------------------------------------------

  function handlePickUp(cellEl, regionName, index, via) {
    const instance = cellEl.getAttribute('data-widget-instance-id');
    // Find the current widgetId from the doc.
    const entries = controller.doc.regions?.[regionName] ?? [];
    const entry = entries[index];
    if (!entry) return;
    controller.pickUp({
      widgetId: entry.widgetId,
      source: { regionName, index },
      via,
    });
    markPickedCell(cellEl, true);
    updateIndicatorValidity();
    announcer.announce(`Picked up ${findDisplayName(entry.widgetId)}. Use arrow keys to choose a drop position, Space or Enter to drop, Escape to cancel.`);
    if (via === 'keyboard') {
      focusFirstValidIndicator();
    }
    void instance;
  }

  function handlePaletteUp({ widgetId, via }) {
    controller.pickUp({ widgetId, source: 'palette', via });
    updateIndicatorValidity();
    const label = findDisplayName(widgetId);
    announcer.announce(`Adding ${label}. Choose a drop position.`);
    toast(`Adding ${label} — click a "Drop here" zone to place it, or press Escape to cancel.`);
    if (via === 'keyboard') focusFirstValidIndicator();
  }

  function handleDropAt({ regionName, index }) {
    const picked = controller.picked;
    if (!picked) return;
    let result;
    if (picked.source === 'palette') {
      const entry = {
        widgetId: picked.widgetId,
        instanceId: freshInstanceId(picked.widgetId),
        config: {},
      };
      result = controller.addFromPalette({ entry, target: { regionName, index } });
    } else {
      result = controller.drop({ target: { regionName, index } });
    }
    if (!result.ok) {
      announcer.announce(`Drop rejected: ${result.reason}`);
      toast(`Drop rejected: ${result.reason}`, 'error');
      return;
    }
    removeGhost();
    markPickedCell(null, false);
    contentPageEl.setAttribute('data-editor-active', 'false');
    void commit(result);
  }

  function handleCancel() {
    if (!controller.picked) return;
    controller.cancel();
    removeGhost();
    markPickedCell(null, false);
    contentPageEl.setAttribute('data-editor-active', 'false');
    updateIndicatorValidity();
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

  // --- pointer drag ----------------------------------------------------

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

  function startPointerDrag(cell, regionName, index, ev) {
    handlePickUp(cell, regionName, index, 'pointer');
    const label = findDisplayName(controller.picked?.widgetId ?? '');
    createGhost(label, ev.clientX ?? 0, ev.clientY ?? 0);

    const win = contentPageEl.ownerDocument?.defaultView ?? window;

    const onMove = (mv) => {
      if (ghostEl) {
        ghostEl.style.left = `${mv.clientX ?? 0}px`;
        ghostEl.style.top = `${mv.clientY ?? 0}px`;
      }
      const under = deepElementFromPoint(mv.clientX, mv.clientY);
      for (const ind of getIndicators()) {
        const hit = under && (ind === under || ind.contains?.(under));
        if (hit) {
          ind.setAttribute('data-hover', 'true');
        } else {
          ind.removeAttribute('data-hover');
        }
      }
    };
    const onUp = (uv) => {
      win.removeEventListener('pointermove', onMove, true);
      win.removeEventListener('pointerup', onUp, true);
      win.removeEventListener('pointercancel', onUp, true);
      const under = deepElementFromPoint(uv?.clientX ?? 0, uv?.clientY ?? 0);
      const overIndicator =
        under && under.closest && under.closest('[data-drop-indicator]');
      if (overIndicator) {
        const regionName = overIndicator.getAttribute('data-region');
        const idx = parseInt(overIndicator.getAttribute('data-index') ?? '-1', 10);
        handleDropAt({ regionName, index: idx });
      } else {
        handleCancel();
      }
    };
    win.addEventListener('pointermove', onMove, true);
    win.addEventListener('pointerup', onUp, true);
    win.addEventListener('pointercancel', onUp, true);
  }

  // --- keyboard indicator navigation -----------------------------------

  function focusFirstValidIndicator() {
    const inds = getIndicators();
    for (const ind of inds) {
      if (ind.getAttribute('data-valid') === 'true') {
        try {
          ind.focus();
        } catch {
          /* linkedom doesn't always implement focus */
        }
        return;
      }
    }
  }

  function moveIndicatorFocus(current, key) {
    const all = getIndicators();
    const valid = all.filter((ind) => ind.getAttribute('data-valid') === 'true');
    if (valid.length === 0) return;
    const idx = valid.indexOf(current);
    let next;
    if (key === 'ArrowLeft' || key === 'ArrowUp') {
      next = valid[(idx - 1 + valid.length) % valid.length];
    } else {
      next = valid[(idx + 1) % valid.length];
    }
    try {
      next?.focus?.();
    } catch {
      /* ignore */
    }
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
    removeGhost();
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
    // Remove indicators (chrome gets torn down when widget-host tears down
    // its cells, which happens on remount).
    for (const ind of getIndicators()) {
      ind.remove?.();
    }
    for (const chrome of widgetHostEl.querySelectorAll('[data-cell-chrome]')) {
      chrome.remove?.();
    }
    for (const cell of widgetHostEl.querySelectorAll('[data-widget-cell][tabindex]')) {
      cell.removeAttribute('tabindex');
      cell.removeAttribute('data-picked');
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
