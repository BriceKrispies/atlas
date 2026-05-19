import { test, expect } from '@playwright/test';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { openSpecimen, selectVariant, widgetCell, widgetTextsInRegion, widgetInstanceIdsInRegion, deleteButton, dragHandle, waitForEditor, } from './helpers.ts';
test.describe('content-page edit mode — delete', function () {
    test('delete button removes a widget from the sidebar slot', async function ({ page }) {
        await openSpecimen(page, 'page.dashboard');
        await selectVariant(page, 'Edit');
        await waitForEditor(page, 'dashboard');
        const [rawId] = await widgetInstanceIdsInRegion(page, 'sidebar');
        const id = assertDefined(rawId, 'sidebar widget instance id');
        await deleteButton(page, id).click({ force: true });
        await expect
            .poll(async function () {
            return (await widgetTextsInRegion(page, 'sidebar')).length;
        })
            .toBe(0);
    });
    test('delete button removes a widget from the main slot (templates no longer require any slot)', async function ({ page }) {
        await openSpecimen(page, 'page.dashboard');
        await selectVariant(page, 'Edit');
        await waitForEditor(page, 'dashboard');
        const [rawId] = await widgetInstanceIdsInRegion(page, 'main');
        const id = assertDefined(rawId, 'main widget instance id');
        await deleteButton(page, id).click({ force: true });
        await expect
            .poll(async function () {
            return (await widgetTextsInRegion(page, 'main')).length;
        })
            .toBe(0);
    });
    test('keyboard Delete key on a focused cell removes the widget', async function ({ page }) {
        await openSpecimen(page, 'page.dashboard');
        await selectVariant(page, 'Edit');
        await waitForEditor(page, 'dashboard');
        const before = await widgetInstanceIdsInRegion(page, 'sidebar');
        expect(before.length).toBe(1);
        const cell = widgetCell(page, 'sidebar', 0);
        await cell.focus();
        await page.keyboard.press('Delete');
        await expect
            .poll(async function () {
            return widgetInstanceIdsInRegion(page, 'sidebar');
        })
            .toEqual([]);
    });
    test('keyboard Backspace on a focused cell removes the widget', async function ({ page }) {
        await openSpecimen(page, 'page.dashboard');
        await selectVariant(page, 'Edit');
        await waitForEditor(page, 'dashboard');
        const [id] = await widgetInstanceIdsInRegion(page, 'sidebar');
        const cell = widgetCell(page, 'sidebar', 0);
        await cell.focus();
        await page.keyboard.press('Backspace');
        await expect
            .poll(async function () {
            return widgetInstanceIdsInRegion(page, 'sidebar');
        })
            .not.toContain(id);
    });
    test('after delete, other slots stay put — nothing reflows', async function ({ page }) {
        // Regression guard for the whole point of the slot model: deleting a
        // widget must not move OR tear down any other widget on the page.
        await openSpecimen(page, 'page.dashboard');
        await selectVariant(page, 'Edit');
        await waitForEditor(page, 'dashboard');
        const [rawMainId] = await widgetInstanceIdsInRegion(page, 'main');
        const [rawSidebarId] = await widgetInstanceIdsInRegion(page, 'sidebar');
        const mainId = assertDefined(rawMainId, 'main widget instance id');
        const sidebarId = assertDefined(rawSidebarId, 'sidebar widget instance id');
        // Capture the sidebar cell's bounding box before the delete so we can
        // assert it hasn't moved.
        const sidebarCell = page.locator(`[data-widget-cell][data-instance-id="${sidebarId}"]`);
        const boxBefore = assertDefined(await sidebarCell.boundingBox(), 'sidebar cell bounding box before delete');
        await deleteButton(page, mainId).click({ force: true });
        await expect
            .poll(async function () {
            return (await widgetInstanceIdsInRegion(page, 'main')).length;
        })
            .toBe(0);
        // Sidebar cell is the same DOM node, at the same position.
        const boxAfter = assertDefined(await sidebarCell.boundingBox(), 'sidebar cell bounding box after delete');
        expect(boxAfter.x).toBe(boxBefore.x);
        expect(boxAfter.y).toBe(boxBefore.y);
        // Chrome on the surviving cell is still live (was fully torn down in
        // the old remount-on-commit path).
        await expect(dragHandle(page, sidebarId)).toBeAttached();
        await expect(deleteButton(page, sidebarId)).toBeAttached();
    });
});
