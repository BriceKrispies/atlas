import { test, expect } from '@playwright/test';
import {
  openSpecimen,
  selectVariant,
  dropIndicator,
  widgetCell,
  pointerDrag,
  widgetTextsInRegion,
} from './helpers.js';

test.describe('content-page edit mode — drag and drop', () => {
  test('palette pickup activates drop indicators', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    // Palette is an AtlasSurface so its own testid is stable.
    const palette = page.locator('[data-testid="widget-palette"]');
    await expect(palette).toBeVisible();

    const chip = page.locator('[data-testid="widget-palette.palette-chip"]').first();
    await expect(chip).toBeVisible();

    // Before pickup, editor is not active.
    const cp = page.locator('content-page[data-page-id="dashboard"]');
    await expect(cp).toHaveAttribute('data-editor-active', 'false').catch(async () => {
      // Attribute may be absent pre-pickup; either absent or 'false' is OK.
      const val = await cp.getAttribute('data-editor-active');
      expect(val === null || val === 'false').toBeTruthy();
    });

    await chip.click();

    // After pickup, the content-page should flip data-editor-active=true
    // and at least one drop indicator must be data-valid=true.
    await expect(cp).toHaveAttribute('data-editor-active', 'true');
    const validIndicators = page.locator(
      '[data-testid="content-page.drop-indicator"][data-valid="true"]',
    );
    await expect(validIndicators.first()).toBeVisible();
  });

  test('reorder: drag main[0] onto the zone after main[1]', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const before = await widgetTextsInRegion(page, 'main');
    expect(before.length).toBe(2);
    const [first, second] = before;
    expect(first).not.toEqual(second);

    // Hover the first cell so its chrome becomes pointer-events:auto,
    // then grab the drag handle and drop on the zone after index 1
    // (i.e. position 2 — the "bottom" of the region).
    const sourceCell = widgetCell(page, 'main', 0);
    await sourceCell.hover();
    const handle = sourceCell.locator('[data-testid="content-page.drag-handle"]');
    await expect(handle).toBeVisible();

    const target = dropIndicator(page, 'main', 2);
    await pointerDrag(page, handle, target);

    // Wait for commit + remount: the new main order should be [second, first].
    await expect
      .poll(async () => widgetTextsInRegion(page, 'main'))
      .toEqual([second, first]);
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
