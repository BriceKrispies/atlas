import { test, expect } from '@playwright/test';
import { openSpecimen, selectVariant, widgetCell, widgetTextsInRegion } from './helpers.js';

test.describe('content-page edit mode — delete', () => {
  test('X button on sidebar widget empties the optional region', async ({ page }) => {
    // Dashboard has 1 widget in sidebar; sidebar is optional, so deletion succeeds.
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const before = await widgetTextsInRegion(page, 'sidebar');
    expect(before.length).toBe(1);

    const cell = widgetCell(page, 'sidebar', 0);
    await cell.hover();
    const del = cell.locator('[data-testid="content-page.delete-button"]');
    await expect(del).toBeVisible();
    await del.click();

    await expect
      .poll(async () => (await widgetTextsInRegion(page, 'sidebar')).length)
      .toBe(0);
  });

  test('consecutive deletes: X clicks in main empty the region, no refusal', async ({
    page,
  }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const initial = await widgetTextsInRegion(page, 'main');
    expect(initial.length).toBe(2);

    // Delete both — pages may have empty regions; the editor must not refuse.
    for (let i = 0; i < 2; i += 1) {
      const cell = widgetCell(page, 'main', 0);
      await cell.hover();
      await cell.locator('[data-testid="content-page.delete-button"]').click();
      await expect
        .poll(async () => (await widgetTextsInRegion(page, 'main')).length)
        .toBe(1 - i);
    }
  });

  test('keyboard Delete key on a focused cell removes the widget', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const before = await widgetTextsInRegion(page, 'main');
    expect(before.length).toBe(2);
    const kept = before[1];

    const cell = widgetCell(page, 'main', 0);
    await cell.focus();
    await page.keyboard.press('Delete');

    await expect
      .poll(async () => widgetTextsInRegion(page, 'main'))
      .toEqual([kept]);
  });

  test('keyboard Backspace on a focused cell removes the widget', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const before = await widgetTextsInRegion(page, 'main');
    const kept = before[1];

    const cell = widgetCell(page, 'main', 0);
    await cell.focus();
    await page.keyboard.press('Backspace');

    await expect
      .poll(async () => widgetTextsInRegion(page, 'main'))
      .toEqual([kept]);
  });

  test('after delete, remaining cell chrome is live (not stale)', async ({ page }) => {
    // Regression guard: after a delete triggers remount, the surviving
    // cell must still expose working chrome (delete button clickable,
    // drag handle visible). If decorate() didn't re-run, chrome would
    // be absent on the rebuilt DOM.
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');

    const firstCell = widgetCell(page, 'main', 0);
    await firstCell.hover();
    await firstCell.locator('[data-testid="content-page.delete-button"]').click();

    await expect
      .poll(async () => (await widgetTextsInRegion(page, 'main')).length)
      .toBe(1);

    const surviving = widgetCell(page, 'main', 0);
    await surviving.hover();
    await expect(
      surviving.locator('[data-testid="content-page.drag-handle"]'),
    ).toBeVisible();
    await expect(
      surviving.locator('[data-testid="content-page.delete-button"]'),
    ).toBeVisible();
  });

  test('deleting the only widget in a region leaves it empty, no error', async ({ page }) => {
    // Welcome has a single widget in main. Since regions may be empty,
    // deletion must succeed and leave main with zero widgets — no fatal
    // "Required region ... is empty" page error.
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');

    const only = widgetCell(page, 'main', 0);
    await only.hover();
    await only.locator('[data-testid="content-page.delete-button"]').click();

    await expect
      .poll(async () => (await widgetTextsInRegion(page, 'main')).length)
      .toBe(0);

    // No fatal error page rendered.
    await expect(
      page.locator('content-page atlas-box:has-text("Required region")'),
    ).toHaveCount(0);
    // No error-variant toast either.
    await expect(
      page.locator('[data-testid="content-page.editor-toast"][data-variant="error"]'),
    ).toHaveCount(0);
  });
});
