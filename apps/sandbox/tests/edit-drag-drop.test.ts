import { test, expect } from '@playwright/test';
import {
  openSpecimen,
  selectVariant,
  widgetCell,
  widgetInstanceIdsInRegion,
  dropSlot,
  paletteChip,
  runEditorOp,
  waitForEditor,
} from './helpers.ts';

test.describe('content-page edit mode — drop into slot', () => {
  test('only empty regions expose a drop slot (filled regions expose none)', async ({ page }) => {
    // welcome seeds main=1 widget, sidebar=empty → exactly one drop slot.
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    await expect(dropSlot(page, 'main')).toHaveCount(0);
    await expect(dropSlot(page, 'sidebar')).toHaveCount(1);
  });

  test('palette renders chips named by widgetId', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'dashboard');

    const palette = page.locator('[data-testid="widget-palette"]');
    await expect(palette).toBeVisible();

    const chip = paletteChip(page, 'content.announcements');
    await expect(chip).toBeVisible();
    await expect(chip).not.toHaveAttribute('draggable', 'true');
  });

  test('palette chip + click on empty slot adds a widget', async ({ page }) => {
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    await paletteChip(page, 'content.announcements').click();
    await dropSlot(page, 'sidebar').click();

    await expect
      .poll(async () => (await widgetInstanceIdsInRegion(page, 'sidebar')).length)
      .toBe(1);
  });

  test('keyboard two-tap: Enter on chip, Enter on empty slot commits an add', async ({ page }) => {
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    const chip = paletteChip(page, 'content.announcements');
    await chip.focus();
    await page.keyboard.press('Enter');

    const slot = dropSlot(page, 'sidebar');
    await slot.focus();
    await page.keyboard.press('Enter');

    await expect
      .poll(async () => (await widgetInstanceIdsInRegion(page, 'sidebar')).length)
      .toBe(1);
  });

  test('Escape clears a pending selection without mutating', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'dashboard');

    const snapshot = await widgetInstanceIdsInRegion(page, 'main');

    await widgetCell(page, 'main', 0).click();
    const cp = page.locator('content-page[data-page-id="dashboard"]');
    await expect(cp).toHaveAttribute('data-editor-selected', /cell:/);

    await page.keyboard.press('Escape');
    await expect(cp).not.toHaveAttribute('data-editor-selected', /.+/);

    expect(await widgetInstanceIdsInRegion(page, 'main')).toEqual(snapshot);
  });

  test('pointer-drag a palette chip into the empty slot commits an add', async ({ page }) => {
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    const chip = paletteChip(page, 'content.announcements');
    const slot = dropSlot(page, 'sidebar');
    const cb = await chip.boundingBox();
    const sb = await slot.boundingBox();
    expect(cb).not.toBeNull();
    expect(sb).not.toBeNull();

    const cx = cb!.x + cb!.width / 2;
    const cy = cb!.y + cb!.height / 2;
    const tx = sb!.x + sb!.width / 2;
    const ty = sb!.y + sb!.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 8, cy + 8, { steps: 2 });
    await page.mouse.move(tx, ty, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => (await widgetInstanceIdsInRegion(page, 'sidebar')).length)
      .toBe(1);
    // Main is untouched — dropping into sidebar does not reorder main.
    expect((await widgetInstanceIdsInRegion(page, 'main')).length).toBe(1);
  });

  test('pointer-drag a cell from one slot into another empty slot', async ({ page }) => {
    // Welcome has main=[1], sidebar=[]. Drag main's cell into the empty
    // sidebar slot. That would empty a required region, so the editor
    // rejects the move and the data stays put.
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    const [mainId] = await widgetInstanceIdsInRegion(page, 'main');
    const source = page.locator(`[data-widget-cell][data-instance-id="${mainId}"]`);
    const slot = dropSlot(page, 'sidebar');
    const sb = await source.boundingBox();
    const zb = await slot.boundingBox();
    if (!sb || !zb) throw new Error('no box');

    const sx = sb.x + sb.width / 2;
    const sy = sb.y + sb.height / 2;
    const tx = zb.x + zb.width / 2;
    const ty = zb.y + zb.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 8, sy + 8, { steps: 2 });
    await page.mouse.move(tx, ty, { steps: 10 });
    await page.mouse.up();

    // Move was rejected (required main would be empty). Nothing moved.
    await page.waitForTimeout(300);
    expect(await widgetInstanceIdsInRegion(page, 'main')).toEqual([mainId]);
    expect(await widgetInstanceIdsInRegion(page, 'sidebar')).toEqual([]);
  });

  test('filled region is not a drop target — dragging onto it is a no-op', async ({ page }) => {
    // Pointer-drag a chip onto a filled region (main). No drop slot exists
    // there, so the drop is rejected silently.
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    const before = await widgetInstanceIdsInRegion(page, 'main');
    expect(before.length).toBe(1);

    const chip = paletteChip(page, 'content.announcements');
    const mainSection = page.locator('section[data-slot="main"]');
    const cb = await chip.boundingBox();
    const mb = await mainSection.boundingBox();
    if (!cb || !mb) throw new Error('no box');

    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.width / 2 + 8, cb.y + cb.height / 2, { steps: 2 });
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2, { steps: 10 });
    await page.mouse.up();

    expect(await widgetInstanceIdsInRegion(page, 'main')).toEqual(before);
  });

  test('imperative API: agents can add / move / remove without the UI', async ({ page }) => {
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    const addRes = await runEditorOp(page, 'welcome', 'add', {
      widgetId: 'content.announcements',
      config: { mode: 'text', text: 'Hello from an agent' },
      region: 'sidebar',
      index: 0,
    });
    expect(addRes.ok).toBe(true);
    const newId = addRes.instanceId;
    expect(typeof newId).toBe('string');

    await expect
      .poll(async () => widgetInstanceIdsInRegion(page, 'sidebar'))
      .toEqual([newId]);

    const rmRes = await runEditorOp(page, 'welcome', 'remove', { instanceId: newId });
    expect(rmRes.ok).toBe(true);
    await expect
      .poll(async () => widgetInstanceIdsInRegion(page, 'sidebar'))
      .toEqual([]);
  });

  test('imperative API: rejected operations return stable reason codes', async ({ page }) => {
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    const unknown = await runEditorOp(page, 'welcome', 'add', {
      widgetId: 'no.such.widget',
      region: 'main',
      index: 0,
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.reason).toBe('unknown-widget');

    const badRegion = await runEditorOp(page, 'welcome', 'add', {
      widgetId: 'content.announcements',
      config: { mode: 'text', text: 'x' },
      region: 'not-a-region',
      index: 0,
    });
    expect(badRegion.ok).toBe(false);
    expect(badRegion.reason).toBe('region-invalid');

    const missing = await runEditorOp(page, 'welcome', 'move', {
      instanceId: 'does-not-exist',
      region: 'main',
      index: 0,
    });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe('instance-not-found');
  });
});
