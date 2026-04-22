/**
 * Observable markers from the Pointer Events DnD subsystem (the native
 * HTML5 path is gone).
 *
 *   - cells have NO `draggable` attribute
 *   - source element gets `data-dnd-source="ghost"` during drag
 *   - hovered drop slot gets `data-dnd-over="true"`
 *   - a clone element with `[data-dnd-overlay-preview]` appears under
 *     <body> and is positioned via `transform: translate3d(...)`
 *
 * Run headed to watch it:
 *   pnpm --filter @atlas/sandbox exec playwright test edit-dnd-subsystem \
 *     --headed --project=chromium --slow-mo=400
 */

import { test, expect } from '@playwright/test';
import {
  openSpecimen,
  selectVariant,
  waitForEditor,
  widgetCell,
  widgetInstanceIdsInRegion,
  dropSlot,
  paletteChip,
} from './helpers.js';

test.describe('DnD subsystem — observable markers', () => {
  test('cells are NOT native-draggable (old HTML5 path is gone)', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'dashboard');

    const cells = page.locator('[data-widget-cell]');
    const count = await cells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const draggable = await cells.nth(i).getAttribute('draggable');
      expect(draggable).toBeNull();
    }
  });

  test('palette chips are NOT native-draggable', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'dashboard');

    const chips = page.locator('[data-testid^="widget-palette.palette-chip-"]');
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const draggable = await chips.nth(i).getAttribute('draggable');
      expect(draggable).not.toBe('true');
    }
  });

  test('pointer drag surfaces subsystem markers and commits into the empty slot', async ({ page }) => {
    // welcome seeds main=1, sidebar=empty → exactly one drop slot on load.
    await openSpecimen(page, 'page.welcome');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'welcome');

    await expect(dropSlot(page, 'sidebar')).toHaveCount(1);

    const chip = paletteChip(page, 'content.announcements');
    const slot = dropSlot(page, 'sidebar');
    const cb = await chip.boundingBox();
    const zb = await slot.boundingBox();
    expect(cb).not.toBeNull();
    expect(zb).not.toBeNull();

    const cx = cb.x + cb.width / 2;
    const cy = cb.y + cb.height / 2;
    const tx = zb.x + zb.width / 2;
    const ty = zb.y + zb.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();

    // Cross the 4px activation threshold.
    await page.mouse.move(cx + 8, cy + 8, { steps: 4 });

    await expect(chip).toHaveAttribute('data-dnd-source', 'ghost');
    const overlay = page.locator('[data-dnd-overlay-preview]');
    await expect(overlay).toBeAttached();
    const transformDuringDrag = await overlay.evaluate(
      (el) => el.parentElement?.style.transform ?? '',
    );
    expect(transformDuringDrag).toMatch(/translate3d\(/);

    // Move into the slot and wait for projection to mark it.
    await page.mouse.move(tx, ty, { steps: 20 });
    await expect(slot).toHaveAttribute('data-dnd-over', 'true');

    await page.mouse.up();

    // Source marker + overlay cleaned up after drop.
    await expect(chip).not.toHaveAttribute('data-dnd-source', /.+/);
    await expect(page.locator('[data-dnd-overlay-preview]')).toHaveCount(0);

    // Commit landed — sidebar now holds one widget, main is untouched.
    await expect
      .poll(async () => (await widgetInstanceIdsInRegion(page, 'sidebar')).length)
      .toBe(1);
    expect((await widgetInstanceIdsInRegion(page, 'main')).length).toBe(1);
  });

  test('short pointer motion below 4px threshold does NOT drag', async ({ page }) => {
    await openSpecimen(page, 'page.dashboard');
    await selectVariant(page, 'Edit');
    await waitForEditor(page, 'dashboard');

    const before = await widgetInstanceIdsInRegion(page, 'main');
    const source = widgetCell(page, 'main', 0);
    const sb = await source.boundingBox();
    const sx = sb.x + sb.width / 2;
    const sy = sb.y + sb.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 2, sy + 1, { steps: 2 });
    await expect(page.locator('[data-dnd-overlay-preview]')).toHaveCount(0);
    await expect(source).not.toHaveAttribute('data-dnd-source', /.+/);
    await page.mouse.up();

    expect(await widgetInstanceIdsInRegion(page, 'main')).toEqual(before);
  });
});
