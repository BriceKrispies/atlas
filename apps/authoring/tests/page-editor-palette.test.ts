/**
 * authoring.page-editor.shell.left-panel.palette — Playwright coverage.
 *
 * Harness choice: same as the outline test — the palette element is not
 * yet mounted by the shell. We open the page editor route, dynamically
 * import the left-panel module to register the custom element, then
 * append a `<page-editor-palette>` to `document.body` with the live
 * shell controller wired in. All assertions run against `document` scope.
 *
 * Once the shell wires `<page-editor-palette>` into the `left:palette`
 * tab slot the harness collapses to a real-tab selector.
 */

import { test, expect, assertCommitted, readEditorState } from '@atlas/test-fixtures';
import type { Page } from '@playwright/test';

const ROUTE = '#/page-editor';
const ROUTE_SURFACE = '[data-testid="authoring.page-editor"]';

interface CommitLike {
  surfaceId?: string;
  intent?: string;
  patch?: unknown;
  at?: number;
}
interface PaletteSnapshot {
  surfaceId: string;
  pageId: string;
  search: string;
  selectedRegion: string | null;
  expandedGroups: string[];
  collapsedGroups: string[];
  recentWidgetIds: string[];
  filteredWidgetIds: string[];
  lastCommit: CommitLike | null;
}

async function waitForEditor(page: Page, pageId: string): Promise<void> {
  await page.waitForFunction((pid: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const cp = root.querySelector(`content-page[data-page-id="${pid}"]`) as
        (Element & { editor?: unknown }) | null;
      if (cp && cp.editor) return true;
      const all = root.querySelectorAll('*');
      for (const el of all) {
        const e = el as Element & { shadowRoot?: ShadowRoot };
        if (e.shadowRoot) stack.push(e.shadowRoot);
      }
    }
    return false;
  }, pageId);
}

async function openEditor(page: Page, pageId: string): Promise<void> {
  await page.goto(`/${ROUTE}`);
  await page.locator(ROUTE_SURFACE).waitFor();
  const select = page.locator(`${ROUTE_SURFACE} >> [data-testid="authoring.page-editor.page-select"]`);
  await select.waitFor();
  const current = await select.evaluate((el: HTMLElement & { value?: string }) => el.value ?? '');
  if (current !== pageId) {
    await select.evaluate((el: HTMLElement & { value: string }, next: string) => {
      el.value = next;
      el.dispatchEvent(
        new CustomEvent('change', { detail: { value: next }, bubbles: true, composed: true }),
      );
    }, pageId);
  }
  await waitForEditor(page, pageId);
}

async function mountPalette(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Vite serves source at this path; tsc can't resolve absolute browser
    // paths, so we hide the import behind a Function constructor.
    const mod = '/src/page-editor/left-panel/index.ts';
    await (new Function('m', 'return import(m)') as (m: string) => Promise<unknown>)(mod);
    const stack: Array<Document | ShadowRoot | Element> = [document];
    let shell: (Element & { editorState?: unknown }) | null = null;
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('authoring-page-editor-shell') as
        (Element & { editorState?: unknown }) | null;
      if (el && el.editorState) {
        shell = el;
        break;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    if (!shell?.editorState) throw new Error('shell controller not ready');
    document.querySelectorAll('page-editor-palette[data-test-mount]').forEach((n) => n.remove());
    const palette = document.createElement('page-editor-palette') as HTMLElement & {
      controller: unknown;
    };
    palette.setAttribute('data-test-mount', 'true');
    palette.controller = shell.editorState;
    document.body.appendChild(palette);
  });
}

async function readPaletteState(page: Page, pageId: string): Promise<PaletteSnapshot | null> {
  return (await readEditorState(page, `${pageId}:palette`)) as PaletteSnapshot | null;
}

async function setSearch(page: Page, value: string): Promise<void> {
  // Drive the input via a synthetic event matching atlas-input's contract.
  await page.evaluate((v: string) => {
    const input = document.querySelector(
      'page-editor-palette[data-test-mount] atlas-input[name="palette-search"]',
    ) as (HTMLElement & { value: string }) | null;
    if (!input) throw new Error('palette search input not mounted');
    input.value = v;
    input.dispatchEvent(new CustomEvent('input', { detail: { value: v }, bubbles: true, composed: true }));
  }, value);
}

async function setRegion(page: Page, value: string): Promise<void> {
  await page.evaluate((v: string) => {
    const select = document.querySelector(
      'page-editor-palette[data-test-mount] atlas-select[name="palette-region-select"]',
    ) as (HTMLElement & { value: string }) | null;
    if (!select) throw new Error('palette region select not mounted');
    select.value = v;
    select.dispatchEvent(new CustomEvent('change', { detail: { value: v }, bubbles: true, composed: true }));
  }, value);
}

test.describe('authoring.page-editor.shell.left-panel.palette — states', () => {
  test('renders search row, region selector, and grouped chip list', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    await mountPalette(page);
    const root = page.locator('page-editor-palette[data-test-mount]');
    await expect(root.locator('atlas-input[name="palette-search"]')).toBeVisible();
    await expect(root.locator('atlas-select[name="palette-region-select"]')).toBeVisible();
    const groups = root.locator('atlas-box[data-role="group"]');
    await expect.poll(async () => groups.count()).toBeGreaterThan(0);
    // Auto-test-id propagation
    const searchInput = root.locator('atlas-input[name="palette-search"]');
    await expect(searchInput).toHaveAttribute(
      'data-testid',
      'authoring.page-editor.shell.left-panel.palette.palette-search',
    );
  });
});

test.describe('authoring.page-editor.shell.left-panel.palette — search', () => {
  test('typing into search filters chips and commits setSearch', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    await mountPalette(page);
    await setSearch(page, 'heading');
    await assertCommitted(
      page,
      'editor:editor-blank:palette',
      { intent: 'setSearch', patch: { search: 'heading' } },
    );
    const snap = await readPaletteState(page, 'editor-blank');
    expect(snap?.filteredWidgetIds).toContain('sandbox.heading');
    for (const id of snap?.filteredWidgetIds ?? []) {
      expect(id.toLowerCase()).toContain('heading');
    }
    // The DOM should reflect the filter — non-matching chips removed.
    const chips = page.locator(
      'page-editor-palette[data-test-mount] atlas-button[data-palette-chip]',
    );
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const id = await chips.nth(i).getAttribute('data-widget-id');
      expect(id?.toLowerCase()).toContain('heading');
    }
  });
});

test.describe('authoring.page-editor.shell.left-panel.palette — group toggle', () => {
  test('clicking the group toggle commits toggleGroup on the palette surface', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    await mountPalette(page);
    const toggle = page.locator(
      'page-editor-palette[data-test-mount] atlas-button[name="palette-group-toggle"]',
    ).first();
    const groupId = await toggle.getAttribute('data-group-id');
    expect(groupId).toBeTruthy();
    await toggle.click();
    await assertCommitted(
      page,
      'editor:editor-blank:palette',
      { intent: 'toggleGroup', patch: { group: groupId, expanded: false } },
    );
    const snap = await readPaletteState(page, 'editor-blank');
    expect(snap?.collapsedGroups).toContain(groupId);
  });
});

test.describe('authoring.page-editor.shell.left-panel.palette — region select', () => {
  test('changing the region select commits selectAddRegion locally', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    await mountPalette(page);
    await setRegion(page, 'sidebar');
    await assertCommitted(
      page,
      'editor:editor-blank:palette',
      { intent: 'selectAddRegion', patch: { region: 'sidebar' } },
    );
    const snap = await readPaletteState(page, 'editor-blank');
    expect(snap?.selectedRegion).toBe('sidebar');
  });
});

test.describe('authoring.page-editor.shell.left-panel.palette — chip click', () => {
  test('chip click commits addWidget on the shell with the selected region', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    await mountPalette(page);
    await setRegion(page, 'sidebar');
    const chip = page.locator(
      'page-editor-palette[data-test-mount] atlas-button[data-palette-chip][data-widget-id="sandbox.heading"]',
    ).first();
    await chip.click();
    await assertCommitted(
      page,
      'editor:editor-blank:shell',
      {
        intent: 'addWidget',
        patch: { widgetId: 'sandbox.heading', region: 'sidebar' },
      },
    );
  });

  test('recents fold the last 5 added widgets', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    await mountPalette(page);
    await setRegion(page, 'main');
    const widgets = ['sandbox.heading', 'sandbox.text', 'sandbox.kpi-tile', 'sandbox.sparkline'];
    for (const widgetId of widgets) {
      await page.locator(
        `page-editor-palette[data-test-mount] atlas-button[data-palette-chip][data-widget-id="${widgetId}"]`,
      ).first().click();
      // Wait for the addWidget commit to land before clicking the next chip
      // so the recents observer sees each commit individually.
      await assertCommitted(
        page,
        'editor:editor-blank:shell',
        { intent: 'addWidget', patch: { widgetId } },
      );
    }
    const snap = await readPaletteState(page, 'editor-blank');
    // Most-recent first; entries are de-duplicated and capped at 5.
    expect(snap?.recentWidgetIds.slice(0, 4)).toEqual(widgets.slice().reverse());
  });
});
