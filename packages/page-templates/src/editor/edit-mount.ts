/**
 * edit-mount.ts — attaches editor UI to a <content-page>.
 *
 * The UI is a thin adapter over the `EditorAPI`. Every user interaction
 * (click, keyboard, drag) ultimately calls one of editor.add / move /
 * remove. Agents and tests can skip the UI entirely and call the API
 * directly via `contentPageEl.editor.add({...})`.
 */
import { EditorController } from './editor-controller.ts';
import { EditorAPI, freshInstanceId } from './editor-api.ts';
import { createAnnouncer, type Announcer } from './a11y.ts';
import { DndController } from '../dnd/controller.ts';
import { ensureDndStyles } from '../dnd/styles.ts';
import { isHtmlElement, must } from '../internal/assert.ts';
// `makeCommit` is imported for parity with the pre-TS module; the runtime
// exposes commit envelopes via EditorAPI._recordCommit.
import { registerTestState, makeCommit } from '@atlas/test-state';
import type { PageDocument } from '../page-store.ts';
import type { TemplateManifest } from '../registry.ts';
import type { WidgetRegistryLike } from '../drop-zones.ts';
import type { CommitResult, DragPayload, DropTarget, } from '../dnd/types.ts';
import type { CommitInfo } from './editor-api.ts';
import type { ValidTargetsResult } from '../drop-zones.ts';
export interface AttachEditorOptions {
    contentPageEl: HTMLElement;
    templateEl: HTMLElement;
    widgetHostEl: HTMLElement;
    pageDoc: PageDocument;
    templateManifest: TemplateManifest;
    widgetRegistry: WidgetRegistryLike;
    onCommit: (nextDoc: PageDocument, info: CommitInfo) => Promise<void>;
    onTelemetry?: (payload: {
        event: string;
        payload: Record<string, unknown>;
    }) => void;
    editorId?: string;
}
type Selection = {
    kind: 'cell';
    instanceId: string;
} | {
    kind: 'chip';
    widgetId: string;
} | null;
export interface EditorHandle {
    controller: EditorController;
    api: EditorAPI;
    announcer: Announcer;
    setPalette: (paletteEl: HTMLElement & {
        onChipSelect?: (arg: {
            widgetId: string;
        }) => void;
        onChipActivate?: (arg: {
            widgetId: string;
            region?: string;
            index?: number;
        }) => void | Promise<void>;
    }) => void;
    detach: () => void;
    refresh: () => void;
    _selectCellForTest: (instanceId: string) => void;
}
export function attachEditor({ contentPageEl, templateEl: _templateEl, widgetHostEl, pageDoc, templateManifest, widgetRegistry, onCommit, onTelemetry, editorId, }: AttachEditorOptions): EditorHandle {
    const controller = new EditorController({
        pageDoc,
        templateManifest,
        widgetRegistry,
    });
    const announcer = createAnnouncer(contentPageEl);
    const telemetry = typeof onTelemetry === 'function' ? onTelemetry : function () { };
    function emitTelemetry(event: string, payload: Record<string, unknown>): void {
        telemetry({ event, payload });
    }
    const resolvedEditorId = editorId ??
        (pageDoc as {
            pageId?: string;
        })?.pageId ??
        contentPageEl.getAttribute?.('data-page-id') ??
        'content-page';
    const surfaceKey = `editor:${resolvedEditorId}`;
    const api = new EditorAPI({
        controller,
        onCommit,
        onTelemetry: emitTelemetry,
        announce: function (msg) {
            return announcer.announce(msg);
        },
        surfaceId: surfaceKey,
    });
    const teardowns: Array<() => void> = [];
    // Expose the editor's committed state to Playwright (dev-only).
    const disposeTestState = registerTestState(surfaceKey, function () {
        return api.getSnapshot();
    });
    teardowns.push(disposeTestState);
    ensureDndStyles(contentPageEl);
    const dndController = new DndController({
        ...(typeof document !== 'undefined' ? { root: document } : {}),
        activationDistance: 4,
        onDrop: async function ({ payload, target }) {
            return commitDndDrop(payload, target);
        },
    });
    dndController.attach();
    teardowns.push(function () {
        return dndController.detach();
    });
    // Expose the DnD session state so Playwright can assert mid-drag
    // (active payload + hovered slot) before the drop lands.
    const disposeDragState = registerTestState('drag:layout', function () {
        const active = dndController._active;
        if (!active)
            return { active: false, payload: null, hoveredSlotId: null };
        return {
            active: true,
            payload: active.source?.getPayload?.() ?? null,
            hoveredSlotId: active.target?.id ?? null,
        };
    });
    teardowns.push(disposeDragState);
    // ---------------------------------------------------------------------
    // Transient selection state (for two-tap flow).
    // ---------------------------------------------------------------------
    let selection: Selection = null;
    function setSelection(next: Selection): void {
        selection = next;
        if (next) {
            contentPageEl.setAttribute('data-editor-selected', `${next.kind}:${next.kind === 'cell' ? next.instanceId : next.widgetId}`);
        }
        else {
            contentPageEl.removeAttribute('data-editor-selected');
        }
        refreshSelectionDecorations();
    }
    function clearSelection(): void {
        if (!selection)
            return;
        setSelection(null);
    }
    function refreshSelectionDecorations(): void {
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
        if (!selection)
            return;
        if (selection.kind === 'cell') {
            const cellEl = widgetHostEl.querySelector(`[data-widget-cell][data-instance-id="${selection.instanceId}"]`);
            if (cellEl)
                cellEl.setAttribute('data-selected', 'true');
            const found = controller.findInstance(selection.instanceId);
            const valid = found
                ? controller.validTargetsFor(found.entry.widgetId, {
                    regionName: found.region,
                    index: found.index,
                })
                : null;
            markSlotValidity(valid);
        }
        else if (selection.kind === 'chip') {
            const chipEl = contentPageEl.querySelector(`[data-palette-chip][data-widget-id="${selection.widgetId}"]`);
            if (chipEl)
                chipEl.setAttribute('data-selected', 'true');
            const valid = controller.validTargetsFor(selection.widgetId, null);
            markSlotValidity(valid);
        }
    }
    function markSlotValidity(validTargets: ValidTargetsResult | null): void {
        if (!validTargets)
            return;
        // Only EMPTY slots are real drop targets; filled slots don't get the
        // active/invalid marker (their cells render normally).
        for (const slot of widgetHostEl.querySelectorAll('section[data-editor-slot][data-empty="true"]')) {
            const region = slot.getAttribute('data-slot');
            const regionEntry = validTargets.validRegions.find(function (r) {
                return r.regionName === region;
            });
            if (regionEntry)
                slot.setAttribute('data-active', 'true');
            else
                slot.setAttribute('data-invalid', 'true');
        }
    }
    // ---------------------------------------------------------------------
    // DOM rendering: one cell OR one drop slot per region.
    // ---------------------------------------------------------------------
    function regionSections(): HTMLElement[] {
        return Array.from(widgetHostEl.querySelectorAll('section[data-slot]')) as HTMLElement[];
    }
    let dndRegistrations: Array<() => void> = [];
    function clearDndRegistrations(): void {
        for (const un of dndRegistrations) {
            try {
                un();
            }
            catch {
                /* ignore */
            }
        }
        dndRegistrations = [];
        dndController.setTargets([]);
    }
    function clearEditorDecorations(): void {
        clearDndRegistrations();
        for (const el of widgetHostEl.querySelectorAll('[data-cell-chrome]')) {
            // Element.remove() is the standard method; widgetHostEl is host-DOM
            // so every match is at minimum an Element with .remove(). The optional
            // chain protects against legacy mocks without it.
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
    function decorate(): void {
        clearEditorDecorations();
        const doc = controller.doc;
        const targets: DropTarget[] = [];
        for (const section of regionSections()) {
            const region = section.getAttribute('data-slot') ?? '';
            const entries = doc?.regions?.[region] ?? [];
            const cells = Array.from(section.querySelectorAll(':scope > [data-widget-cell]')) as HTMLElement[];
            for (let i = 0; i < cells.length; i++) {
                decorateCell(must(cells[i], 'cells[i] in-range by loop construction'), region, i, entries[i]);
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
                    accepts: function (payload: DragPayload) {
                        return payload?.type === 'cell' || payload?.type === 'chip';
                    },
                });
            }
        }
        dndController.setTargets(targets);
    }
    // Delegated click + keyboard handlers for empty slots.
    function onHostClick(ev: Event): void {
        if (!(ev.target instanceof Element))
            return;
        const section = ev.target.closest?.('section[data-slot][data-empty="true"]');
        if (!section || !widgetHostEl.contains(section))
            return;
        const region = section.getAttribute('data-slot');
        if (!region)
            return;
        ev.stopPropagation();
        void onSlotActivated(region);
    }
    function onHostKeydown(ev: KeyboardEvent): void {
        if (!isHtmlElement(ev.target))
            return;
        const section = ev.target;
        if (section.tagName !== 'SECTION')
            return;
        if (!section.hasAttribute('data-empty'))
            return;
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
            ev.preventDefault();
            const region = section.getAttribute('data-slot');
            if (region)
                void onSlotActivated(region);
        }
        else if (ev.key === 'Escape') {
            ev.preventDefault();
            clearSelection();
        }
    }
    widgetHostEl.addEventListener('click', onHostClick);
    widgetHostEl.addEventListener('keydown', onHostKeydown);
    teardowns.push(function () {
        widgetHostEl.removeEventListener('click', onHostClick);
        widgetHostEl.removeEventListener('keydown', onHostKeydown);
    });
    function decorateCell(cellEl: HTMLElement, region: string, index: number, entry: {
        instanceId?: string;
        widgetId?: string;
    } | undefined): void {
        const instanceId = entry?.instanceId ?? `cell-${region}-${index}`;
        cellEl.setAttribute('tabindex', '0');
        cellEl.setAttribute('data-instance-id', instanceId);
        cellEl.setAttribute('data-region', region);
        cellEl.setAttribute('data-cell-index', String(index));
        cellEl.setAttribute('name', `cell-${instanceId}`);
        for (const old of cellEl.querySelectorAll(':scope > [data-cell-chrome]')) {
            old.remove?.();
        }
        const ownerDoc = contentPageEl.ownerDocument ?? document;
        const chrome = ownerDoc.createElement('atlas-box');
        chrome.setAttribute('data-cell-chrome', '');
        chrome.setAttribute('name', `chrome-${instanceId}`);
        const handle = ownerDoc.createElement('atlas-button');
        handle.setAttribute('name', `drag-handle-${instanceId}`);
        handle.setAttribute('size', 'sm');
        handle.setAttribute('variant', 'ghost');
        handle.setAttribute('aria-label', 'Drag widget');
        handle.setAttribute('tabindex', '-1');
        handle.textContent = '⋮⋮';
        const del = ownerDoc.createElement('atlas-button');
        del.setAttribute('name', `delete-${instanceId}`);
        del.setAttribute('size', 'sm');
        del.setAttribute('variant', 'danger');
        del.setAttribute('aria-label', 'Delete widget');
        del.textContent = '×';
        del.addEventListener('click', async function (ev: Event) {
            ev.stopPropagation();
            const res = await api.remove({ instanceId });
            if (res.ok) {
                announcer.announce(`${findDisplayName(entry?.widgetId)} deleted.`);
            }
            else {
                announcer.announce(`Cannot delete: ${res.reason}.`);
            }
        });
        chrome.appendChild(handle);
        chrome.appendChild(del);
        cellEl.appendChild(chrome);
        cellEl.addEventListener('click', function (ev: Event) {
            if (ev.target instanceof Element && ev.target.closest('[name^="delete-"]'))
                return;
            ev.stopPropagation();
            toggleCellSelection(instanceId);
        });
        cellEl.addEventListener('keydown', function (kev: KeyboardEvent) {
            if (kev.target !== cellEl)
                return;
            if (kev.key === 'Enter' || kev.key === ' ' || kev.key === 'Spacebar') {
                kev.preventDefault();
                toggleCellSelection(instanceId);
            }
            else if (kev.key === 'Delete' || kev.key === 'Backspace') {
                kev.preventDefault();
                void api.remove({ instanceId }).then(function (res) {
                    if (res.ok)
                        announcer.announce(`${findDisplayName(entry?.widgetId)} deleted.`);
                    else
                        announcer.announce(`Cannot delete: ${res.reason}.`);
                });
            }
            else if (kev.key === 'Escape') {
                kev.preventDefault();
                clearSelection();
            }
        });
        const unreg = dndController.registerSource({
            element: cellEl,
            containerId: region,
            getPayload: function () {
                return ({ type: 'cell', id: instanceId });
            },
        });
        dndRegistrations.push(unreg);
    }
    function toggleCellSelection(instanceId: string): void {
        if (selection && selection.kind === 'cell' && selection.instanceId === instanceId) {
            clearSelection();
            return;
        }
        setSelection({ kind: 'cell', instanceId });
        const entry = controller.findInstance(instanceId);
        const label = findDisplayName(entry?.entry?.widgetId);
        announcer.announce(`Selected ${label}. Click or press Enter on a drop slot to move it, or press Escape to cancel.`);
    }
    // ---------------------------------------------------------------------
    // Slot activations.
    // ---------------------------------------------------------------------
    async function onSlotActivated(region: string): Promise<void> {
        if (!selection) {
            announcer.announce('Select a widget or palette item first.');
            return;
        }
        await commitSlot(region);
    }
    async function commitDndDrop(payload: DragPayload, target: DropTarget): Promise<CommitResult> {
        const region = target?.containerId;
        if (!payload || typeof region !== 'string') {
            return { ok: false, reason: 'invalid-target' };
        }
        let res;
        if (payload.type === 'cell') {
            res = await api.move({ instanceId: payload.id, region, index: 0 });
        }
        else if (payload.type === 'chip') {
            res = await api.add({ widgetId: payload.id, region, index: 0 });
        }
        else {
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
        // ApiResult unions to CommitResult-compatible shape; reason is optional
        // in both. exactOptionalPropertyTypes catches the union's `reason?: string | undefined`
        // mismatch with `reason?: string` — the runtime values are identical.
        return res as CommitResult;
    }
    async function commitSlot(region: string): Promise<void> {
        if (!selection)
            return;
        let res;
        if (selection.kind === 'cell') {
            res = await api.move({
                instanceId: selection.instanceId,
                region,
                index: 0,
            });
        }
        else {
            res = await api.add({ widgetId: selection.widgetId, region, index: 0 });
        }
        announceResult(res, region);
        clearSelection();
    }
    function announceResult(res: {
        ok: boolean;
        reason?: string;
        noop?: boolean;
        action?: string;
        widgetId?: string;
    }, region: string): void {
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
        }
        else if (res.action === 'add') {
            announcer.announce(`${label} added to ${region}.`);
        }
    }
    function findDisplayName(widgetId: string | null | undefined): string {
        if (!widgetId)
            return 'widget';
        try {
            const entry: unknown = widgetRegistry.get?.(widgetId);
            const dn = readDisplayName(entry);
            return dn ?? widgetId;
        }
        catch {
            return widgetId;
        }
    }
    function readDisplayName(entry: unknown): string | null {
        if (!entry || typeof entry !== 'object' || !('manifest' in entry))
            return null;
        const manifest = entry.manifest;
        if (!manifest || typeof manifest !== 'object' || !('displayName' in manifest))
            return null;
        const dn = manifest.displayName;
        return typeof dn === 'string' ? dn : null;
    }
    // ---------------------------------------------------------------------
    // Palette hookup.
    // ---------------------------------------------------------------------
    let paletteDndUnregs: Array<() => void> = [];
    function clearPaletteDndRegistrations(): void {
        for (const un of paletteDndUnregs) {
            try {
                un();
            }
            catch {
                /* ignore */
            }
        }
        paletteDndUnregs = [];
    }
    function registerPaletteChips(paletteEl: HTMLElement): void {
        clearPaletteDndRegistrations();
        const chips = paletteEl.querySelectorAll('[data-palette-chip]');
        for (const chip of chips) {
            const widgetId = chip.getAttribute('data-widget-id');
            if (!widgetId)
                continue;
            if (!(chip instanceof HTMLElement))
                continue;
            const unreg = dndController.registerSource({
                element: chip,
                containerId: 'palette',
                getPayload: function () {
                    return ({ type: 'chip', id: widgetId });
                },
            });
            paletteDndUnregs.push(unreg);
        }
    }
    function setPalette(paletteEl: HTMLElement & {
        onChipSelect?: (arg: {
            widgetId: string;
        }) => void;
        onChipActivate?: (arg: {
            widgetId: string;
            region?: string;
            index?: number;
        }) => void | Promise<void>;
    }): void {
        paletteEl.onChipSelect = function ({ widgetId }) {
            setSelection({ kind: 'chip', widgetId });
            announcer.announce(`Adding ${findDisplayName(widgetId)}. Click or press Enter on a drop slot to place it, or press Escape to cancel.`);
        };
        paletteEl.onChipActivate = async function ({ widgetId, region }) {
            const targetRegion = region ?? '';
            const res = await api.add({ widgetId, region: targetRegion, index: 0 });
            announceResult(res, targetRegion);
            clearSelection();
        };
        registerPaletteChips(paletteEl);
        if (typeof MutationObserver !== 'undefined') {
            const mo = new MutationObserver(function () {
                return registerPaletteChips(paletteEl);
            });
            mo.observe(paletteEl, { childList: true, subtree: true });
            teardowns.push(function () {
                return mo.disconnect();
            });
        }
        teardowns.push(clearPaletteDndRegistrations);
    }
    const onDocKey = function (kev: KeyboardEvent): void {
        if (kev.key === 'Escape' && selection) {
            clearSelection();
        }
    };
    contentPageEl.addEventListener('keydown', onDocKey);
    teardowns.push(function () {
        return contentPageEl.removeEventListener('keydown', onDocKey);
    });
    decorate();
    function detach(): void {
        clearSelection();
        clearEditorDecorations();
        for (const fn of teardowns) {
            try {
                fn();
            }
            catch {
                /* best effort */
            }
        }
        contentPageEl.removeAttribute('data-editor-selected');
        (announcer.element as HTMLElement).remove?.();
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
        refresh: function () {
            return decorate();
        },
        _selectCellForTest(instanceId: string): void {
            setSelection({ kind: 'cell', instanceId });
        },
    };
}
export { freshInstanceId };
