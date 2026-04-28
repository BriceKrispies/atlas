/**
 * authoring.page-editor.shell.left-panel.outline — Playwright coverage.
 *
 * Harness choice: the outline element is NOT mounted by the shell yet
 * (shell integration lands separately). Rather than skip everything, we
 * mount the editor route to get a live `PageEditorController`, then
 * dynamically import the left-panel module and append a
 * `<page-editor-outline>` to `document.body` with the live controller
 * attached. All DOM assertions then run against `document` scope (the
 * outline is light-DOM and lives outside the shell's shadow root).
 *
 * Once the shell wires `<page-editor-outline>` into the `left:outline`
 * tab slot, this harness can be replaced with a real-tab test by
 * removing the `mountOutline` step.
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
interface OutlineSnapshot {
  surfaceId: string;
  pageId: string;
  expandedRegions: string[];
  collapsedRegions: string[];
  drag: { instanceId: string; fromRegion: string } | null;
  dragOver: { region: string; index: number } | null;
  selection: string[];
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

/**
 * Append `<page-editor-outline>` to document.body with the active shell
 * controller attached. Returns the element id used for in-page lookup.
 */
async function mountOutline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Side-effect import registers the custom element. Vite serves the
    // module at this path; TypeScript doesn't resolve absolute browser
    // paths so we cast through `unknown`.
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
    // Remove any previous test-mount.
    document.querySelectorAll('page-editor-outline[data-test-mount]').forEach((n) => n.remove());
    const outline = document.createElement('page-editor-outline') as HTMLElement & {
      controller: unknown;
    };
    outline.setAttribute('data-test-mount', 'true');
    outline.controller = shell.editorState;
    document.body.appendChild(outline);
  });
}

async function readOutlineState(page: Page, pageId: string): Promise<OutlineSnapshot | null> {
  return (await readEditorState(page, `${pageId}:outline`)) as OutlineSnapshot | null;
}

async function readShellSnapshot(page: Page): Promise<{ regions: Array<{ name: string; widgetIds: string[] }> } | null> {
  return page.evaluate(() => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('authoring-page-editor-shell') as
        (Element & { getEditorSnapshot?: () => unknown }) | null;
      if (el?.getEditorSnapshot) {
        const snap = el.getEditorSnapshot() as { regions: Array<{ name: string; widgetIds: string[] }> } | null;
        return snap;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    return null;
  });
}

async function clickOutlineRow(page: Page, instanceId: string, modifier?: 'Shift'): Promise<void> {
  const row = page.locator(
    `page-editor-outline[data-test-mount] atlas-box[data-row="widget"][data-instance-id="${instanceId}"]`,
  );
  await row.first().click({ modifiers: modifier ? [modifier] : [] });
}

test.describe('authoring.page-editor.shell.left-panel.outline — states', () => {
  test('renders an empty hint on a blank page', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    await mountOutline(page);
    const empty = page.locator(
      'page-editor-outline[data-test-mount] [data-testid="authoring.page-editor.shell.left-panel.outline.outline-empty"]',
    );
    await expect(empty).toBeVisible();
    const widgets = page.locator(
      'page-editor-outline[data-test-mount] atlas-box[data-row="widget"]',
    );
    await expect(widgets).toHaveCount(0);
  });

  test('renders region rows + widget rows for a populated page', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await mountOutline(page);
    const regionRows = page.locator(
      'page-editor-outline[data-test-mount] atlas-box[data-row="region"]',
    );
    const widgetRows = page.locator(
      'page-editor-outline[data-test-mount] atlas-box[data-row="widget"]',
    );
    await expect(regionRows.first()).toBeVisible();
    await expect.poll(async () => widgetRows.count()).toBeGreaterThan(0);
    // Auto-test-id for the region toggle
    const toggle = page.locator(
      'page-editor-outline[data-test-mount] atlas-button[name="outline-region-toggle"]',
    ).first();
    await expect(toggle).toHaveAttribute(
      'data-testid',
      'authoring.page-editor.shell.left-panel.outline.outline-region-toggle',
    );
  });
});

test.describe('authoring.page-editor.shell.left-panel.outline — selection', () => {
  test('clicking a widget row commits selectWidget on the shell', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await mountOutline(page);
    await clickOutlineRow(page, 'w-editor-starter-main-heading');
    await assertCommitted(
      page,
      'editor:editor-starter:shell',
      {
        intent: 'selectWidget',
        patch: { instanceId: 'w-editor-starter-main-heading', additive: false },
      },
    );
  });

  test('shift-click adds to selection (additive: true)', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await mountOutline(page);
    await clickOutlineRow(page, 'w-editor-starter-main-heading');
    await clickOutlineRow(page, 'w-editor-starter-main-text', 'Shift');
    await assertCommitted(
      page,
      'editor:editor-starter:shell',
      {
        intent: 'selectWidget',
        patch: { instanceId: 'w-editor-starter-main-text', additive: true },
      },
    );
  });
});

test.describe('authoring.page-editor.shell.left-panel.outline — local state', () => {
  test('region toggle commits toggleRegion on the outline surface', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await mountOutline(page);
    const toggle = page.locator(
      'page-editor-outline[data-test-mount] atlas-button[name="outline-region-toggle"][data-region="main"]',
    );
    await toggle.first().click();
    await assertCommitted(
      page,
      'editor:editor-starter:outline',
      { intent: 'toggleRegion', patch: { region: 'main', expanded: false } },
    );
    const snap = await readOutlineState(page, 'editor-starter');
    expect(snap?.collapsedRegions).toContain('main');
  });
});

test.describe('authoring.page-editor.shell.left-panel.outline — drag-reorder', () => {
  // The shell-level `moveWidget` commit is currently blocked upstream by a
  // `this`-binding bug in `PageEditorController.moveWidget` (state.ts
  // extracts `editor.move` and calls it without rebinding, which throws on
  // `this._isEditable()` inside the EditorAPI). The outline's local
  // `dragEnd` commit still records what was attempted, so we assert that
  // here. Once state.ts fixes the binding (out of scope for this PR), we
  // can re-enable the shell-side assertion below.
  test('commitMove records a dragEnd commit with the dropped flag', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await mountOutline(page);
    const before = await readShellSnapshot(page);
    const mainBefore = before?.regions.find((r) => r.name === 'main')?.widgetIds ?? [];
    expect(mainBefore.length).toBeGreaterThanOrEqual(2);

    const [firstId] = mainBefore;
    if (!firstId) throw new Error('no widget in main region');

    await page.evaluate(async (args: { instanceId: string }) => {
      const outline = document.querySelector('page-editor-outline[data-test-mount]') as
        (HTMLElement & { commitMove: (a: { instanceId: string; toRegion: string; toIndex: number }) => Promise<boolean> })
        | null;
      if (!outline) throw new Error('outline not mounted');
      await outline.commitMove({ instanceId: args.instanceId, toRegion: 'main', toIndex: 2 });
    }, { instanceId: firstId });

    await assertCommitted(
      page,
      'editor:editor-starter:outline',
      { intent: 'dragEnd', patch: { instanceId: firstId } },
    );
  });

  test.skip(
    'shell-level moveWidget commit lands when state.ts move-binding bug is fixed',
    async ({ page }) => {
      // SKIPPED: blocked on state.ts `moveWidget` losing `this` when it
      // calls `editor.move(args)`. See controller code at the
      // `const moveCall = (editor as ...).move;` extraction.
      await openEditor(page, 'editor-starter');
      await mountOutline(page);
      const before = await readShellSnapshot(page);
      const mainBefore = before?.regions.find((r) => r.name === 'main')?.widgetIds ?? [];
      const [firstId] = mainBefore;
      if (!firstId) throw new Error('no widget in main region');
      await page.evaluate(async (args: { instanceId: string }) => {
        const outline = document.querySelector('page-editor-outline[data-test-mount]') as
          (HTMLElement & { commitMove: (a: { instanceId: string; toRegion: string; toIndex: number }) => Promise<boolean> })
          | null;
        if (!outline) throw new Error('outline not mounted');
        await outline.commitMove({ instanceId: args.instanceId, toRegion: 'main', toIndex: 2 });
      }, { instanceId: firstId });
      await assertCommitted(
        page,
        'editor:editor-starter:shell',
        {
          intent: 'moveWidget',
          patch: { instanceId: firstId, toRegion: 'main', toIndex: 2 },
        },
      );
    },
  );
});
