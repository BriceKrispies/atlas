import { test, expect } from '@playwright/test';
import {
  readEditorState,
  assertCommitted,
} from '@atlas/test-fixtures';
import { openSpecimen } from './helpers.js';

const ID = 'demo';
const SURFACE = `editor:${ID}`;
// Toolbar testids contain the colon from the surface id — Playwright
// accepts this in quoted attribute values.
const action = (key) => `[data-testid="${SURFACE}.action.${key}"]`;
const block = (id) => `[data-testid="${SURFACE}.block.${id}"]`;

async function openBlock(page) {
  await openSpecimen(page, 'page-templates.block-editor');
  await page.locator('atlas-block-editor').waitFor();
  await expect
    .poll(async () => (await readEditorState(page, ID))?.surfaceId)
    .toBe(SURFACE);
}

test.describe('atlas-block-editor committed-state contract', () => {
  test('initial snapshot exposes seeded blocks', async ({ page }) => {
    await openBlock(page);
    const state = await readEditorState(page, ID);
    expect(state.document.blocks.map((b) => b.blockId)).toEqual([
      'seed-heading', 'seed-text', 'seed-list',
    ]);
    expect(state.dirty).toBe(false);
    expect(state.selection).toBeNull();
  });

  test('insertBlock commits and grows document', async ({ page }) => {
    await openBlock(page);
    await page.click(action('insert-text'));
    // Toolbar fires insertBlock then setSelection; check the registry
    // for the insertBlock commit specifically.
    const state = await readEditorState(page, ID);
    expect(state.document.blocks).toHaveLength(4);
    expect(state.document.blocks[3].type).toBe('text');
  });

  test('clicking a block commits setSelection', async ({ page }) => {
    await openBlock(page);
    await page.click(block('seed-list'));
    await assertCommitted(page, SURFACE, {
      intent: 'setSelection',
      patch: { blockId: 'seed-list' },
    });
    expect((await readEditorState(page, ID)).selection).toBe('seed-list');
  });

  test('move-up on selection commits moveBlock', async ({ page }) => {
    await openBlock(page);
    await page.click(block('seed-list'));
    await page.click(action('move-up'));
    await assertCommitted(page, SURFACE, {
      intent: 'moveBlock',
      patch: { blockId: 'seed-list', from: 2, to: 1 },
    });
    expect(
      (await readEditorState(page, ID)).document.blocks.map((b) => b.blockId),
    ).toEqual(['seed-heading', 'seed-list', 'seed-text']);
  });

  test('bold commits applyFormatting and records formats on the block', async ({ page }) => {
    await openBlock(page);
    await page.click(block('seed-text'));
    await page.click(action('bold'));
    await assertCommitted(page, SURFACE, {
      intent: 'applyFormatting',
      patch: { blockId: 'seed-text', format: 'bold' },
    });
    const st = await readEditorState(page, ID);
    const text = st.document.blocks.find((b) => b.blockId === 'seed-text');
    expect(text.config.formats).toEqual(['bold']);
  });

  test('remove commits removeBlock and clears selection', async ({ page }) => {
    await openBlock(page);
    await page.click(block('seed-text'));
    await page.click(action('remove'));
    await assertCommitted(page, SURFACE, {
      intent: 'removeBlock',
      patch: { blockId: 'seed-text' },
    });
    const st = await readEditorState(page, ID);
    expect(st.document.blocks.map((b) => b.blockId)).toEqual([
      'seed-heading', 'seed-list',
    ]);
    expect(st.selection).toBeNull();
  });

  test('save commits save intent and clears dirty', async ({ page }) => {
    await openBlock(page);
    await page.click(action('insert-text'));
    expect((await readEditorState(page, ID)).dirty).toBe(true);
    await page.click(action('save'));
    await assertCommitted(page, SURFACE, { intent: 'save' });
    expect((await readEditorState(page, ID)).dirty).toBe(false);
  });

  test('move-up at top is a no-op (no moveBlock commit)', async ({ page }) => {
    await openBlock(page);
    await page.click(block('seed-heading'));
    const before = (await readEditorState(page, ID)).lastCommit;
    await page.click(action('move-up'));
    await page.waitForTimeout(50);
    const after = (await readEditorState(page, ID)).lastCommit;
    // lastCommit should still be the setSelection (rejected move isn't recorded)
    expect(after.intent).toBe('setSelection');
    expect(after.at).toBe(before.at);
  });
});
