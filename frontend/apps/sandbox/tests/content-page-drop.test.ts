import { test, expect } from '@playwright/test';
import {
  readEditorState,
  readDragState,
  assertCommitted,
} from '@atlas/test-fixtures';
import {
  openSpecimen,
  selectVariant,
  waitForEditor,
  paletteChip,
  dropSlot,
} from './helpers.ts';
import type { Page } from '@playwright/test';

const PAGE = 'welcome';
const SURFACE = `editor:${PAGE}`;

async function openEditor(page: Page): Promise<void> {
  await openSpecimen(page, 'page.welcome');
  await selectVariant(page, 'Edit');
  await waitForEditor(page, PAGE);
  // Give the test-state registry a moment to pick up the editor.
  await expect
    .poll(async () => ((await readEditorState(page, PAGE)) as { surfaceId?: string } | null)?.surfaceId)
    .toBe(SURFACE);
}

test.describe('content-page editor — committed-state contract', () => {
  test('two-tap add commits an `add` intent on the editor', async ({ page }) => {
    await openEditor(page);
    await paletteChip(page, 'content.announcements').click();
    await dropSlot(page, 'sidebar').click();

    await assertCommitted(page, SURFACE, { intent: 'add' });
    const state = (await readEditorState(page, PAGE)) as {
      lastCommit: { patch: { widgetId: string; to: { region: string } } };
      entries: Array<{ region: string }>;
      dirty: boolean;
    };
    expect(state.lastCommit.patch.widgetId).toBe('content.announcements');
    expect(state.lastCommit.patch.to.region).toBe('sidebar');
    expect(state.entries.some((e) => e.region === 'sidebar')).toBe(true);
    expect(state.dirty).toBe(true);
  });

  test('drag state reader is inactive when idle', async ({ page }) => {
    await openEditor(page);
    const drag = await readDragState(page);
    expect(drag).toEqual({ active: false, payload: null, hoveredSlotId: null });
  });

  test('pointer drag of a palette chip into an empty slot commits `drop`', async ({ page }) => {
    await openEditor(page);
    const chip = paletteChip(page, 'content.announcements');
    const slot = dropSlot(page, 'sidebar');

    const chipBox = await chip.boundingBox();
    const slotBox = await slot.boundingBox();
    if (!chipBox || !slotBox) throw new Error('missing box');

    await page.mouse.move(
      chipBox.x + chipBox.width / 2,
      chipBox.y + chipBox.height / 2,
    );
    await page.mouse.down();
    // Pointer subsystem activates at ~4px. Move in stages so hovered
    // target resolves cleanly and the drag reader reports `active`.
    await page.mouse.move(
      chipBox.x + chipBox.width / 2 + 10,
      chipBox.y + chipBox.height / 2 + 10,
      { steps: 4 },
    );
    await page.mouse.move(
      slotBox.x + slotBox.width / 2,
      slotBox.y + slotBox.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();

    await assertCommitted(page, SURFACE, { intent: 'drop' });
    const state = (await readEditorState(page, PAGE)) as {
      lastCommit: { patch: { toRegion: string; underlying: string } };
    };
    expect(state.lastCommit.patch.toRegion).toBe('sidebar');
    expect(state.lastCommit.patch.underlying).toBe('add');
  });
});
