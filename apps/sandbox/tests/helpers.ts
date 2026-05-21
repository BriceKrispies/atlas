/**
 * Sandbox-specific Playwright helpers.
 *
 * The editor is built around an imperative, instance-keyed EditorAPI and
 * explicit <atlas-box data-drop-slot> DOM elements (one per empty region
 * — filled regions render no slot). Every slot, cell, and cell-chrome
 * control has a unique `name` attribute that becomes a stable
 * auto-generated data-testid, so tests never need pointer-geometry math.
 *
 * Drag is handled by the internal DnD subsystem (Pointer Events, not the
 * native HTML5 DnD API). For reliable mutations in tests prefer the
 * bypass-UI helper `runEditorOp(page, ...)`; to exercise the sensor
 * end-to-end, use `page.mouse.down/move/up` on real coordinates.
 */
import type { Page, Locator } from '@playwright/test';
export type EditorOp = 'add' | 'move' | 'update' | 'remove' | 'list' | 'get' | 'can';
/**
 * Load a specific specimen by id (e.g. "page.welcome"). Uses the URL
 * `?specimen=` param so the test isn't coupled to sidebar click order.
 */
export async function openSpecimen(page: Page, specimenId: string): Promise<void> {
    await page.goto(`/?specimen=${encodeURIComponent(specimenId)}`);
    await page.waitForSelector(`atlas-nav-item.item[data-id="${specimenId}"][aria-selected="true"]`);
}
/**
 * Switch to a configVariant by clicking its state-bar button.
 */
export async function selectVariant(page: Page, variantName: string): Promise<void> {
    const slug = String(variantName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const tab = page.locator(`[data-testid="sandbox.variant-switcher.${slug}"]`);
    await tab.click();
    const selected = await tab.getAttribute('aria-selected');
    if (selected !== 'true') {
        throw new Error(`Tab is not selected (aria-selected=${selected})`);
    }
}
/**
 * Locator for the nth widget cell inside a region.
 */
export function widgetCell(page: Page, region: string, index: number): Locator {
    return page
        .locator(`section[data-slot="${region}"] > [data-widget-cell]`)
        .nth(index);
}
/**
 * Locator for a region's drop slot. Each region section is the slot; in
 * edit mode an EMPTY slot carries `data-empty="true"` and accepts drops.
 * A filled slot has no `data-empty` and ignores drops (so the locator
 * below only matches empty slots — that's the "droppable slot").
 */
export function dropSlot(page: Page, region: string): Locator {
    return page.locator(`section[data-editor-slot="${region}"][data-empty="true"]`);
}
/**
 * Locator for the delete button on a cell, keyed by instanceId.
 */
export function deleteButton(page: Page, instanceId: string): Locator {
    return page.locator(`[data-testid="content-page.delete-${instanceId}"]`);
}
/**
 * Locator for the drag handle on a cell, keyed by instanceId.
 */
export function dragHandle(page: Page, instanceId: string): Locator {
    return page.locator(`[data-testid="content-page.drag-handle-${instanceId}"]`);
}
/**
 * Locator for a palette chip by widgetId.
 */
export function paletteChip(page: Page, widgetId: string): Locator {
    return page.locator(`[data-testid="widget-palette.palette-chip-${widgetId}"]`);
}
/**
 * Read the text contents of every widget in a region, in order. Useful
 * for asserting reorder results without caring about instanceIds.
 */
export async function widgetTextsInRegion(page: Page, region: string): Promise<string[]> {
    return page
        .locator(`section[data-slot="${region}"] > [data-widget-cell]`)
        .allInnerTexts();
}
/**
 * Read the ordered instanceIds of widgets in a region.
 */
export async function widgetInstanceIdsInRegion(page: Page, region: string): Promise<Array<string | null>> {
    return page
        .locator(`section[data-slot="${region}"] > [data-widget-cell]`)
        .evaluateAll(function (els) {
        return els.map(function (el) {
            return el.getAttribute('data-instance-id');
        });
    });
}
/**
 * Wait for a <content-page> to have its imperative editor API attached.
 * Must be called after selectVariant('Edit'), before any runEditorOp /
 * chrome-click assertion that depends on the editor being live.
 *
 * The sandbox app mounts specimens inside <atlas-sandbox>'s shadow root,
 * so `document.querySelector('content-page[...]')` returns null — we have
 * to walk shadow roots breadth-first.
 */
export async function waitForEditor(page: Page, pageId: string): Promise<void> {
    await page.waitForFunction(function (pid: string) {
        interface ContentPageEl extends Element {
            editor?: unknown;
        }
        const deepFind = function (id: string): ContentPageEl | null {
            const stack: Array<Document | ShadowRoot | Element> = [document];
            while (stack.length) {
                const root = stack.shift();
                if (!root)
                    continue;
                const found = 'querySelector' in root && root.querySelector
                    ? root.querySelector<ContentPageEl>(`content-page[data-page-id="${id}"]`)
                    : null;
                if (found)
                    return found;
                const descendants = 'querySelectorAll' in root && root.querySelectorAll
                    ? Array.from(root.querySelectorAll('*'))
                    : [];
                for (const el of descendants) {
                    if (el.shadowRoot) {
                        stack.push(el.shadowRoot);
                    }
                }
            }
            return null;
        };
        const cp = deepFind(pid);
        return !!(cp && cp.editor);
    }, pageId);
}
export interface EditorOpResult {
    ok: boolean;
    reason?: string;
    instanceId?: string;
    [k: string]: unknown;
}
/**
 * Call the imperative editor API exposed at contentPageEl.editor.
 * Use this when a test wants to drive a mutation the way an agent or
 * another surface would — skipping the UI entirely. Returns the API's
 * result object (`{ ok, ... }`).
 */
export async function runEditorOp(page: Page, pageId: string, op: EditorOp, args?: unknown): Promise<EditorOpResult> {
    const raw = await page.evaluate(function ({ pageId, op, args }: {
        pageId: string;
        op: string;
        args: unknown;
    }) {
        interface ContentPageEl extends Element {
            editor?: Record<string, unknown>;
        }
        const deepFind = function (id: string): ContentPageEl | null {
            const stack: Array<Document | ShadowRoot | Element> = [document];
            while (stack.length) {
                const root = stack.shift();
                if (!root)
                    continue;
                const found = 'querySelector' in root && root.querySelector
                    ? root.querySelector<ContentPageEl>(`content-page[data-page-id="${id}"]`)
                    : null;
                if (found)
                    return found;
                const descendants = 'querySelectorAll' in root && root.querySelectorAll
                    ? Array.from(root.querySelectorAll('*'))
                    : [];
                for (const el of descendants) {
                    if (el.shadowRoot)
                        stack.push(el.shadowRoot);
                }
            }
            return null;
        };
        const cp = deepFind(pageId);
        if (!cp || !cp.editor)
            return { ok: false, reason: 'editor-not-attached' };
        // The editor API is an imperative bag of method handles, typed
        // structurally as `Record<string, unknown>` on the element. We
        // re-view it as a record of `(a) => unknown | undefined` so the
        // `typeof handler !== 'function'` narrow yields a callable, and
        // run a single boundary-cast here rather than per call-site.
        const editor = cp.editor as Record<string, ((a: unknown) => unknown) | undefined>;
        const handler = editor[op];
        if (typeof handler !== 'function')
            return { ok: false, reason: 'op-not-found' };
        return handler.call(cp.editor, args);
    }, { pageId, op, args });
    return raw as EditorOpResult;
}
/**
 * Set the viewport to a small phone size (iPhone SE) so responsive/mobile
 * assertions operate at the framework's mobile-first base breakpoint.
 */
export async function setMobileViewport(page: Page): Promise<void> {
    await page.setViewportSize({ width: 360, height: 640 });
}
