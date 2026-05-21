/**
 * authoring.block-editor — Playwright coverage.
 *
 * The block-editor route hosts `<atlas-block-editor>` against either a
 * seeded document (3 blocks: heading/text/list) or an empty document. The
 * inner editor registers with the test-state registry under
 * `editor:demo` (seeded) and `editor:empty`.
 */
import { test, expect, readEditorState, assertCommitted } from '@atlas/test-fixtures';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { Page } from '@playwright/test';
const ROUTE = '#/block-editor';
const ROUTE_SURFACE = '[data-testid="authoring.block-editor"]';
const SEEDED_ID = 'demo';
const EMPTY_ID = 'empty';
const SEEDED_KEY = `editor:${SEEDED_ID}`;
const action = function (key: string): string {
    return `[data-testid="${SEEDED_KEY}.action.${key}"]`;
};
const block = function (id: string): string {
    return `[data-testid="${SEEDED_KEY}.block.${id}"]`;
};
// ── typed snapshot shapes ──────────────────────────────────────────
interface BlockEntry {
    blockId: string;
    type: string;
    config?: {
        formats?: string[];
    };
}
interface EditorSnapshot {
    surfaceId: string;
    document: {
        blocks: BlockEntry[];
    };
    selection: string | null;
    dirty: boolean;
    lastCommit: {
        at: number;
        intent: string;
    } | null;
}
/**
 * Boundary: `readEditorState` returns `unknown` by design (the
 * test-state registry is shape-erased). The block-editor surface
 * reader is part of the surface's spec — its snapshot shape is fixed
 * by the controller and reasserted by every test that reads it. One
 * justified narrowing here keeps all call sites clean.
 */
async function readEditor(page: Page, id: string): Promise<EditorSnapshot | null> {
    const snap = await readEditorState(page, id);
    return snap as EditorSnapshot | null;
}
async function readEditorOrThrow(page: Page, id: string): Promise<EditorSnapshot> {
    return assertDefined(await readEditor(page, id), `editor snapshot for ${id}`);
}
async function openSeeded(page: Page): Promise<void> {
    await page.goto(`/${ROUTE}`);
    await page.locator(ROUTE_SURFACE).waitFor();
    // The seeded variant is the default; just wait for the editor to register.
    await expect
        .poll(async function () {
        return (await readEditor(page, SEEDED_ID))?.surfaceId;
    })
        .toBe(SEEDED_KEY);
}
async function openEmpty(page: Page): Promise<void> {
    await page.goto(`/${ROUTE}`);
    await page.locator(ROUTE_SURFACE).waitFor();
    await page.locator(`${ROUTE_SURFACE} >> [data-testid="authoring.block-editor.empty"]`).click();
    await expect
        .poll(async function () {
        return (await readEditor(page, EMPTY_ID))?.surfaceId;
    })
        .toBe(`editor:${EMPTY_ID}`);
}
// ── states ──────────────────────────────────────────────────────────
test.describe('authoring.block-editor — states', function () {
    test('route surface mounts on hash navigation', async function ({ page }) {
        await page.goto(`/${ROUTE}`);
        await expect(page.locator(ROUTE_SURFACE)).toBeVisible();
    });
    test('seeded variant button is auto-tagged with its surfaceId-derived testId', async function ({ page }) {
        await page.goto(`/${ROUTE}`);
        const seeded = page.locator(`${ROUTE_SURFACE} >> [data-testid="authoring.block-editor.seeded"]`);
        const empty = page.locator(`${ROUTE_SURFACE} >> [data-testid="authoring.block-editor.empty"]`);
        await expect(seeded).toBeVisible();
        await expect(empty).toBeVisible();
    });
    test('switching to empty remounts the editor under editor:empty', async function ({ page }) {
        await openEmpty(page);
        const state = await readEditorOrThrow(page, EMPTY_ID);
        expect(state.document.blocks).toEqual([]);
        expect(state.selection).toBeNull();
    });
});
// ── committed-state contract on the seeded variant ──────────────────
test.describe('authoring.block-editor — seeded committed-state', function () {
    test('initial snapshot exposes the seeded blocks', async function ({ page }) {
        await openSeeded(page);
        const state = await readEditorOrThrow(page, SEEDED_ID);
        expect(state.document.blocks.map(function (b) {
            return b.blockId;
        })).toEqual([
            'seed-heading', 'seed-text', 'seed-list',
        ]);
        expect(state.dirty).toBe(false);
        expect(state.selection).toBeNull();
    });
    test('insertBlock commits and grows the document', async function ({ page }) {
        await openSeeded(page);
        await page.click(action('insert-text'));
        const state = await readEditorOrThrow(page, SEEDED_ID);
        expect(state.document.blocks).toHaveLength(4);
        expect(assertDefined(state.document.blocks[3], 'block at index 3 after insert').type).toBe('text');
    });
    test('clicking a block commits setSelection', async function ({ page }) {
        await openSeeded(page);
        await page.click(block('seed-list'));
        await assertCommitted(page, SEEDED_KEY, {
            intent: 'setSelection',
            patch: { blockId: 'seed-list' },
        });
        const state = await readEditorOrThrow(page, SEEDED_ID);
        expect(state.selection).toBe('seed-list');
    });
    test('move-up on selection commits moveBlock', async function ({ page }) {
        await openSeeded(page);
        await page.click(block('seed-list'));
        await page.click(action('move-up'));
        await assertCommitted(page, SEEDED_KEY, {
            intent: 'moveBlock',
            patch: { blockId: 'seed-list', from: 2, to: 1 },
        });
        const state = await readEditorOrThrow(page, SEEDED_ID);
        expect(state.document.blocks.map(function (b) {
            return b.blockId;
        })).toEqual([
            'seed-heading', 'seed-list', 'seed-text',
        ]);
    });
    test('bold commits applyFormatting and records formats on the block', async function ({ page }) {
        await openSeeded(page);
        await page.click(block('seed-text'));
        await page.click(action('bold'));
        await assertCommitted(page, SEEDED_KEY, {
            intent: 'applyFormatting',
            patch: { blockId: 'seed-text', format: 'bold' },
        });
        const st = await readEditorOrThrow(page, SEEDED_ID);
        const text = assertDefined(st.document.blocks.find(function (b) {
            return b.blockId === 'seed-text';
        }), 'seed-text block after applyFormatting');
        expect(text.config?.formats).toEqual(['bold']);
    });
    test('remove commits removeBlock and clears selection', async function ({ page }) {
        await openSeeded(page);
        await page.click(block('seed-text'));
        await page.click(action('remove'));
        await assertCommitted(page, SEEDED_KEY, {
            intent: 'removeBlock',
            patch: { blockId: 'seed-text' },
        });
        const st = await readEditorOrThrow(page, SEEDED_ID);
        expect(st.document.blocks.map(function (b) {
            return b.blockId;
        })).toEqual([
            'seed-heading', 'seed-list',
        ]);
        expect(st.selection).toBeNull();
    });
    test('save clears the dirty flag', async function ({ page }) {
        await openSeeded(page);
        await page.click(action('insert-text'));
        expect((await readEditorOrThrow(page, SEEDED_ID)).dirty).toBe(true);
        // Save is a host-app concern, not a controller intent — the toolbar
        // calls markClean() directly. Observable contract is the dirty flag.
        await page.click(action('save'));
        await expect
            .poll(async function () {
            return (await readEditorOrThrow(page, SEEDED_ID)).dirty;
        })
            .toBe(false);
    });
    test('move-up at top is a no-op (no moveBlock commit)', async function ({ page }) {
        await openSeeded(page);
        await page.click(block('seed-heading'));
        const before = assertDefined((await readEditorOrThrow(page, SEEDED_ID)).lastCommit, 'lastCommit after initial selection');
        await page.click(action('move-up'));
        await page.waitForTimeout(50);
        const after = assertDefined((await readEditorOrThrow(page, SEEDED_ID)).lastCommit, 'lastCommit after no-op move-up');
        expect(after.intent).toBe('setSelection');
        expect(after.at).toBe(before.at);
    });
});
