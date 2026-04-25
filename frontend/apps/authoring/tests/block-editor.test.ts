/**
 * authoring.block-editor — Playwright coverage.
 *
 * The block-editor route hosts `<atlas-block-editor>` against either a
 * seeded document (3 blocks: heading/text/list) or an empty document. The
 * inner editor registers with the test-state registry under
 * `editor:demo` (seeded) and `editor:empty`.
 */

import { test, expect, readEditorState, assertCommitted } from '@atlas/test-fixtures';
import type { Page } from '@playwright/test';

const ROUTE = '#/block-editor';
const ROUTE_SURFACE = '[data-testid="authoring.block-editor"]';

const SEEDED_ID = 'demo';
const EMPTY_ID = 'empty';
const SEEDED_KEY = `editor:${SEEDED_ID}`;

const action = (key: string): string => `[data-testid="${SEEDED_KEY}.action.${key}"]`;
const block = (id: string): string => `[data-testid="${SEEDED_KEY}.block.${id}"]`;

async function openSeeded(page: Page): Promise<void> {
  await page.goto(`/${ROUTE}`);
  await page.locator(ROUTE_SURFACE).waitFor();
  // The seeded variant is the default; just wait for the editor to register.
  await expect
    .poll(async () => ((await readEditorState(page, SEEDED_ID)) as { surfaceId?: string } | null)?.surfaceId)
    .toBe(SEEDED_KEY);
}

async function openEmpty(page: Page): Promise<void> {
  await page.goto(`/${ROUTE}`);
  await page.locator(ROUTE_SURFACE).waitFor();
  await page.locator(`${ROUTE_SURFACE} >> [data-testid="authoring.block-editor.empty"]`).click();
  await expect
    .poll(async () => ((await readEditorState(page, EMPTY_ID)) as { surfaceId?: string } | null)?.surfaceId)
    .toBe(`editor:${EMPTY_ID}`);
}

// ── states ──────────────────────────────────────────────────────────

test.describe('authoring.block-editor — states', () => {
  test('route surface mounts on hash navigation', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await expect(page.locator(ROUTE_SURFACE)).toBeVisible();
  });

  test('seeded variant button is auto-tagged with its surfaceId-derived testId', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    const seeded = page.locator(`${ROUTE_SURFACE} >> [data-testid="authoring.block-editor.seeded"]`);
    const empty = page.locator(`${ROUTE_SURFACE} >> [data-testid="authoring.block-editor.empty"]`);
    await expect(seeded).toBeVisible();
    await expect(empty).toBeVisible();
  });

  test('switching to empty remounts the editor under editor:empty', async ({ page }) => {
    await openEmpty(page);
    const state = (await readEditorState(page, EMPTY_ID)) as
      { document: { blocks: unknown[] }; selection: unknown } | null;
    expect(state).not.toBeNull();
    expect(state!.document.blocks).toEqual([]);
    expect(state!.selection).toBeNull();
  });
});

// ── committed-state contract on the seeded variant ──────────────────

test.describe('authoring.block-editor — seeded committed-state', () => {
  test('initial snapshot exposes the seeded blocks', async ({ page }) => {
    await openSeeded(page);
    const state = (await readEditorState(page, SEEDED_ID)) as {
      document: { blocks: Array<{ blockId: string }> };
      dirty: boolean;
      selection: unknown;
    };
    expect(state.document.blocks.map((b) => b.blockId)).toEqual([
      'seed-heading', 'seed-text', 'seed-list',
    ]);
    expect(state.dirty).toBe(false);
    expect(state.selection).toBeNull();
  });

  test('insertBlock commits and grows the document', async ({ page }) => {
    await openSeeded(page);
    await page.click(action('insert-text'));
    const state = (await readEditorState(page, SEEDED_ID)) as {
      document: { blocks: Array<{ type: string }> };
    };
    expect(state.document.blocks).toHaveLength(4);
    expect(state.document.blocks[3]!.type).toBe('text');
  });

  test('clicking a block commits setSelection', async ({ page }) => {
    await openSeeded(page);
    await page.click(block('seed-list'));
    await assertCommitted(page, SEEDED_KEY, {
      intent: 'setSelection',
      patch: { blockId: 'seed-list' },
    });
    const state = (await readEditorState(page, SEEDED_ID)) as { selection: unknown };
    expect(state.selection).toBe('seed-list');
  });

  test('move-up on selection commits moveBlock', async ({ page }) => {
    await openSeeded(page);
    await page.click(block('seed-list'));
    await page.click(action('move-up'));
    await assertCommitted(page, SEEDED_KEY, {
      intent: 'moveBlock',
      patch: { blockId: 'seed-list', from: 2, to: 1 },
    });
    const state = (await readEditorState(page, SEEDED_ID)) as {
      document: { blocks: Array<{ blockId: string }> };
    };
    expect(state.document.blocks.map((b) => b.blockId)).toEqual([
      'seed-heading', 'seed-list', 'seed-text',
    ]);
  });

  test('bold commits applyFormatting and records formats on the block', async ({ page }) => {
    await openSeeded(page);
    await page.click(block('seed-text'));
    await page.click(action('bold'));
    await assertCommitted(page, SEEDED_KEY, {
      intent: 'applyFormatting',
      patch: { blockId: 'seed-text', format: 'bold' },
    });
    const st = (await readEditorState(page, SEEDED_ID)) as {
      document: { blocks: Array<{ blockId: string; config?: { formats?: string[] } }> };
    };
    const text = st.document.blocks.find((b) => b.blockId === 'seed-text');
    expect(text!.config?.formats).toEqual(['bold']);
  });

  test('remove commits removeBlock and clears selection', async ({ page }) => {
    await openSeeded(page);
    await page.click(block('seed-text'));
    await page.click(action('remove'));
    await assertCommitted(page, SEEDED_KEY, {
      intent: 'removeBlock',
      patch: { blockId: 'seed-text' },
    });
    const st = (await readEditorState(page, SEEDED_ID)) as {
      document: { blocks: Array<{ blockId: string }> };
      selection: unknown;
    };
    expect(st.document.blocks.map((b) => b.blockId)).toEqual([
      'seed-heading', 'seed-list',
    ]);
    expect(st.selection).toBeNull();
  });

  test('save clears the dirty flag', async ({ page }) => {
    await openSeeded(page);
    await page.click(action('insert-text'));
    expect(((await readEditorState(page, SEEDED_ID)) as { dirty: boolean }).dirty).toBe(true);

    // The toolbar's _save calls controller.markClean(); the controller
    // does not register `save` as a mutation intent (so it has no
    // committed-state record), so we observe the dirty transition.
    await page.click(action('save'));
    await expect
      .poll(async () => ((await readEditorState(page, SEEDED_ID)) as { dirty: boolean }).dirty)
      .toBe(false);
  });

  test('move-up at top is a no-op (no moveBlock commit)', async ({ page }) => {
    await openSeeded(page);
    await page.click(block('seed-heading'));
    const before = ((await readEditorState(page, SEEDED_ID)) as { lastCommit: { at: number; intent: string } }).lastCommit;
    await page.click(action('move-up'));
    await page.waitForTimeout(50);
    const after = ((await readEditorState(page, SEEDED_ID)) as { lastCommit: { at: number; intent: string } }).lastCommit;
    expect(after.intent).toBe('setSelection');
    expect(after.at).toBe(before.at);
  });
});
