import { test, expect } from '@playwright/test';
import {
  openSpecimen,
  selectVariant,
  widgetCell,
  emptyDropZone,
  pointerDrag,
  widgetTextsInRegion,
} from './helpers.js';

test.describe('content-page edit mode — drag and drop (widget-anchored)', () => {
  test('palette pickup activates editor and highlights hovered cells', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const palette = page.locator('[data-testid="widget-palette"]');
    await expect(palette).toBeVisible();

    const chip = page.locator('[data-testid="widget-palette.palette-chip"]').first();
    await expect(chip).toBeVisible();

    const cp = page.locator('content-page[data-page-id="dashboard"]');
    await expect(cp).toHaveAttribute('data-editor-active', 'false').catch(async () => {
      const val = await cp.getAttribute('data-editor-active');
      expect(val === null || val === 'false').toBeTruthy();
    });

    await chip.click();
    await expect(cp).toHaveAttribute('data-editor-active', 'true');

    // Hover the top half of the first main cell; assert the cell picks up
    // a "before" half highlight.
    const firstMain = widgetCell(page, 'main', 0);
    const box = await firstMain.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.2);
    await expect(firstMain).toHaveAttribute('data-drop-target', 'before');

    // Move to the bottom half — it should flip to "after".
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
    await expect(firstMain).toHaveAttribute('data-drop-target', 'after');
  });

  test('no persistent drop-indicator bars are rendered in edit mode', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    // The widget-anchored redesign removed all between-cell indicator bars.
    await expect(page.locator('[data-drop-indicator]')).toHaveCount(0);
  });

  test('reorder: drag main[0] onto the bottom half of main[1]', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const before = await widgetTextsInRegion(page, 'main');
    expect(before.length).toBe(2);
    const [first, second] = before;
    expect(first).not.toEqual(second);

    const sourceCell = widgetCell(page, 'main', 0);
    await sourceCell.hover();
    const handle = sourceCell.locator('[data-testid="content-page.drag-handle"]');
    await expect(handle).toBeVisible();

    // With source (main[0]) hidden on pickup, the only visible main cell is
    // the one that was at main[1]. Dropping on its bottom half = "after",
    // which inserts source below it → new order [second, first].
    const target = widgetCell(page, 'main', 1);
    await pointerDrag(page, handle, target, { half: 'after' });

    await expect
      .poll(async () => widgetTextsInRegion(page, 'main'))
      .toEqual([second, first]);
  });

  test('reorder: drag main[1] onto the top half of main[0]', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const before = await widgetTextsInRegion(page, 'main');
    expect(before.length).toBe(2);
    const [first, second] = before;
    expect(first).not.toEqual(second);

    const sourceCell = widgetCell(page, 'main', 1);
    await sourceCell.hover();
    const handle = sourceCell.locator('[data-testid="content-page.drag-handle"]');
    await expect(handle).toBeVisible();

    const target = widgetCell(page, 'main', 0);
    await pointerDrag(page, handle, target, { half: 'before' });

    await expect
      .poll(async () => widgetTextsInRegion(page, 'main'))
      .toEqual([second, first]);
  });

  test('whole cell is grabbable (not just the drag handle)', async ({ page }) => {
    // Regression: pointerdown anywhere on the cell — not only on the
    // corner drag-handle button — starts a drag. The widget body is
    // pointer-events:none in edit mode so its own click/pointer handlers
    // can't swallow the pickup.
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const before = await widgetTextsInRegion(page, 'main');
    expect(before.length).toBe(2);
    const [first, second] = before;

    // Start the press in the middle of the cell — away from the chrome.
    const sourceCell = widgetCell(page, 'main', 0);
    const sbox = await sourceCell.boundingBox();
    const sx = sbox.x + sbox.width / 2;
    const sy = sbox.y + sbox.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();

    // Source flips to picked (display:none) as soon as pointerdown fires.
    await expect(sourceCell).toHaveAttribute('data-picked', 'true');

    const target = widgetCell(page, 'main', 1);
    const tbox = await target.boundingBox();
    const tx = tbox.x + tbox.width / 2;
    const ty = tbox.y + tbox.height * 0.8;
    await page.mouse.move(tx, ty, { steps: 4 });
    await page.mouse.up();

    await expect
      .poll(async () => widgetTextsInRegion(page, 'main'))
      .toEqual([second, first]);
  });

  test('picking up a widget hides its cell and collapses the gap', async ({ page }) => {
    // Regression: source cell is display:none during pickup so the visible
    // layout is the peer cell(s), each exposing top/bottom halves as drop
    // targets. No persistent drop bars stack in the gap.
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const sourceCell = widgetCell(page, 'main', 1);
    await sourceCell.hover();
    const handle = sourceCell.locator('[data-testid="content-page.drag-handle"]');
    await expect(handle).toBeVisible();

    const hbox = await handle.boundingBox();
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
    await page.mouse.down();

    await expect(sourceCell).toHaveAttribute('data-picked', 'true');
    await expect(sourceCell).toBeHidden();
    // No drop-indicator elements exist anywhere.
    await expect(page.locator('[data-drop-indicator]')).toHaveCount(0);

    await page.mouse.up();
  });

  test('empty region: palette drop into an emptied region', async ({ page }) => {
    // Empty a region (welcome.sidebar has one widget) then pick from the
    // palette and drop into the empty-region zone.
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');

    const sidebarOnly = widgetCell(page, 'sidebar', 0);
    await sidebarOnly.hover();
    await sidebarOnly.locator('[data-testid="content-page.delete-button"]').click();

    await expect
      .poll(async () => (await widgetTextsInRegion(page, 'sidebar')).length)
      .toBe(0);

    // Pick from palette.
    const chip = page.locator('[data-testid="widget-palette.palette-chip"]').first();
    await chip.click();

    // The sidebar section now shows a rectangular empty-drop zone.
    const zone = emptyDropZone(page, 'sidebar');
    await expect(zone).toBeVisible();
    await expect(zone).toHaveAttribute('data-drop-valid', 'true');

    // Click the zone to drop.
    const zbox = await zone.boundingBox();
    await page.mouse.move(zbox.x + zbox.width / 2, zbox.y + zbox.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    await expect
      .poll(async () => (await widgetTextsInRegion(page, 'sidebar')).length)
      .toBe(1);
  });

  test('delete: X on first main widget removes it from the page', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const before = await widgetTextsInRegion(page, 'main');
    expect(before.length).toBe(2);
    const kept = before[1];

    const target = widgetCell(page, 'main', 0);
    await target.hover();
    const del = target.locator('[data-testid="content-page.delete-button"]');
    await expect(del).toBeVisible();
    await del.click();

    await expect
      .poll(async () => widgetTextsInRegion(page, 'main'))
      .toEqual([kept]);
  });

  test('delete: emptying a region is permitted with no error toast', async ({ page }) => {
    // Pages may have empty regions — the template's `required` flag is
    // informational only and not enforced at runtime.
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');

    const only = widgetCell(page, 'main', 0);
    await only.hover();
    await only.locator('[data-testid="content-page.delete-button"]').click();

    await expect
      .poll(async () => (await widgetTextsInRegion(page, 'main')).length)
      .toBe(0);

    await expect(
      page.locator('[data-testid="content-page.editor-toast"][data-variant="error"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('content-page atlas-box:has-text("Required region")'),
    ).toHaveCount(0);
  });
});
