/**
 * authoring.page-editor — Playwright coverage.
 *
 * The authoring page-editor route hosts the inner `<sandbox-page-editor>`
 * shell against an in-memory page store seeded with two starter pages
 * (editor-starter, editor-blank). The route surface owns the picker; the
 * inner shell owns toolbar, canvas, inspector, palette, undo/redo,
 * multi-select, preview, and template switcher.
 *
 * These tests cover both layers: the route picker mounts and remounts the
 * shell, and the inner shell exposes its functional contract through the
 * imperative `editor` API plus deep-pierced DOM assertions.
 */

import { test, expect } from '@atlas/test-fixtures';
import type { Page, JSHandle } from '@playwright/test';

const ROUTE = '#/page-editor';
const ROUTE_SURFACE = '[data-testid="authoring.page-editor"]';

interface EditorOpResult {
  ok?: boolean;
  reason?: string;
  [k: string]: unknown;
}

/**
 * Wait for the inner editor shell to mount its content-page editor API
 * for the given pageId. The shell is two shadow roots deep
 * (`<atlas-authoring>` -> route element -> `<sandbox-page-editor>`).
 */
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

/**
 * Open the page editor route and wait for the inner editor to mount on
 * the given seed pageId. Picker is changed if needed.
 */
async function openEditor(page: Page, pageId: string): Promise<void> {
  await page.goto(`/${ROUTE}`);
  await page.locator(ROUTE_SURFACE).waitFor();
  // Switch picker if the requested seed isn't the default.
  const select = page.locator(`${ROUTE_SURFACE} >> [data-testid="authoring.page-editor.page-select"]`);
  await select.waitFor();
  const current = await select.evaluate((el: HTMLElement & { value?: string }) => el.value ?? '');
  if (current !== pageId) {
    await select.evaluate((el: HTMLElement & { value: string }, next: string) => {
      el.value = next;
      el.dispatchEvent(new CustomEvent('change', { detail: { value: next }, bubbles: true, composed: true }));
    }, pageId);
  }
  await waitForEditor(page, pageId);
}

/** Run an op against the imperative editor API on the active content-page. */
async function runEditorOp(
  page: Page,
  pageId: string,
  op: string,
  args?: unknown,
): Promise<EditorOpResult> {
  return page.evaluate(({ pid, op, args }: { pid: string; op: string; args: unknown }) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const cp = root.querySelector(`content-page[data-page-id="${pid}"]`) as
        (Element & { editor?: Record<string, unknown> }) | null;
      if (cp && cp.editor) {
        return (cp.editor[op] as (a: unknown) => unknown)(args);
      }
      const all = root.querySelectorAll('*');
      for (const el of all) {
        const e = el as Element & { shadowRoot?: ShadowRoot };
        if (e.shadowRoot) stack.push(e.shadowRoot);
      }
    }
    return { ok: false, reason: 'editor-not-found' };
  }, { pid: pageId, op, args }) as Promise<EditorOpResult>;
}

async function listEditor(
  page: Page,
  pageId: string,
): Promise<Array<{ widgetId: string; instanceId: string; region: string }>> {
  return runEditorOp(page, pageId, 'list') as unknown as Promise<
    Array<{ widgetId: string; instanceId: string; region: string }>
  >;
}

/** Read a property from the inner shell's shadow root by selector. */
async function shellShadowQuery(
  page: Page,
  selector: string,
): Promise<{ ok: boolean; text?: string | null }> {
  return page.evaluate((sel: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('sandbox-page-editor') as
        (Element & { shadowRoot?: ShadowRoot }) | null;
      if (el?.shadowRoot) {
        const hit = el.shadowRoot.querySelector(sel) as HTMLElement | null;
        if (hit) return { ok: true, text: hit.textContent };
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    return { ok: false };
  }, selector);
}

/** Click an element inside the inner shell's shadow root. */
async function clickInShell(page: Page, selector: string): Promise<void> {
  const handle: JSHandle<Element | null> = await page.evaluateHandle((sel: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('sandbox-page-editor') as
        (Element & { shadowRoot?: ShadowRoot }) | null;
      if (el?.shadowRoot) {
        const hit = el.shadowRoot.querySelector(sel);
        if (hit) return hit;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    return null;
  }, selector);
  const el = handle.asElement();
  if (!el) throw new Error(`selector not found in shell shadow: ${selector}`);
  await el.click();
}

/** Click a widget cell by instance id inside the inner shell. */
async function clickCell(
  page: Page,
  instanceId: string,
  modifier?: 'Shift' | 'Meta' | 'Control' | 'Alt',
): Promise<void> {
  const handle: JSHandle<Element | null> = await page.evaluateHandle((id: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const shell = root.querySelector('sandbox-page-editor') as
        (Element & { shadowRoot?: ShadowRoot }) | null;
      if (shell?.shadowRoot) {
        const hit = shell.shadowRoot.querySelector(
          `[data-widget-cell][data-instance-id="${id}"]`,
        );
        if (hit) return hit;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    return null;
  }, instanceId);
  const el = handle.asElement();
  if (!el) throw new Error(`cell not found: ${instanceId}`);
  await el.click({ modifiers: modifier ? [modifier] : [] });
}

// ── states ──────────────────────────────────────────────────────────

test.describe('authoring.page-editor — states', () => {
  test('route surface mounts on hash navigation', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    const surface = page.locator(ROUTE_SURFACE);
    await expect(surface).toBeVisible();
  });

  test('picker exposes the auto-generated test id', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    const select = page.locator(
      `${ROUTE_SURFACE} >> [data-testid="authoring.page-editor.page-select"]`,
    );
    await expect(select).toBeVisible();
  });

  test('inner editor shell mounts on the default seed', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const toolbar = await shellShadowQuery(page, 'atlas-box[data-role="toolbar"]');
    expect(toolbar.ok).toBe(true);
    const canvas = await shellShadowQuery(page, 'atlas-box[data-role="canvas"]');
    expect(canvas.ok).toBe(true);
  });
});

// ── shell + seed ────────────────────────────────────────────────────

test.describe('authoring.page-editor — shell + seed', () => {
  test('starter mounts with toolbar, canvas, inspector', async ({ page }) => {
    await openEditor(page, 'editor-starter');

    expect((await shellShadowQuery(page, 'atlas-button[name="undo"]')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'atlas-button[name="redo"]')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'page-editor-property-panel')).ok).toBe(true);
  });

  test('starter renders the four seeded widgets', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const list = await listEditor(page, 'editor-starter');
    const widgetIds = list.map((e) => e.widgetId).sort();
    expect(widgetIds).toEqual(
      ['sandbox.heading', 'sandbox.kpi-tile', 'sandbox.sparkline', 'sandbox.text'].sort(),
    );
  });

  test('switching picker to editor-blank remounts with zero widgets', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const list = await listEditor(page, 'editor-blank');
    expect(list).toEqual([]);
  });

  test('save-status initialises to "saved"', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const status = await shellShadowQuery(page, 'atlas-text[name="save-status"]');
    expect(status.text?.trim()).toBe('saved');
  });
});

// ── palette ─────────────────────────────────────────────────────────

test.describe('authoring.page-editor — palette', () => {
  test('palette lists all five editor widgets as chips', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const expected = [
      'sandbox.heading',
      'sandbox.text',
      'sandbox.kpi-tile',
      'sandbox.sparkline',
      'sandbox.data-table',
    ];
    for (const id of expected) {
      const chip = await shellShadowQuery(
        page,
        `[data-palette-chip][data-widget-id="${id}"]`,
      );
      expect(chip.ok, `palette chip for ${id} should be present`).toBe(true);
    }
  });

  test('adding via editor.add appends the widget to its region', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'main',
      config: { level: 2, text: 'Added from a test' },
    });
    expect(res.ok).toBe(true);
    const list = await listEditor(page, 'editor-blank');
    expect(list.length).toBe(1);
    expect(list[0]!.widgetId).toBe('sandbox.heading');
    expect(list[0]!.region).toBe('main');
  });

  test('adding an unknown widget returns reason=unknown-widget', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'does.not.exist',
      region: 'main',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unknown-widget');
  });

  test('adding into an invalid region returns reason=region-invalid', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'no-such-region',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('region-invalid');
  });
});

// ── property panel ──────────────────────────────────────────────────

test.describe('authoring.page-editor — property panel', () => {
  test('clicking a widget populates the inspector', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');

    const title = await shellShadowQuery(page, 'atlas-heading[name="inspector-title"]');
    expect(title.ok).toBe(true);
    expect(title.text).toMatch(/Heading/i);

    const subtitle = await shellShadowQuery(page, 'atlas-text[name="inspector-subtitle"]');
    expect(subtitle.ok).toBe(true);
    expect(subtitle.text).toContain('sandbox.heading');
  });

  test('clicking the canvas clears the inspector', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');
    expect((await shellShadowQuery(page, 'atlas-heading[name="inspector-title"]')).ok).toBe(true);

    await clickInShell(page, 'atlas-box[data-role="canvas"]');
    expect((await shellShadowQuery(page, 'atlas-heading[name="inspector-title"]')).ok).toBe(false);
  });
});

// ── undo / redo ─────────────────────────────────────────────────────

test.describe('authoring.page-editor — undo/redo', () => {
  test('add → undo → redo round-trips', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'main',
      config: { level: 2, text: 'round-trip' },
    });
    expect(res.ok).toBe(true);
    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(1);

    await clickInShell(page, 'atlas-button[name="undo"]');
    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(0);

    await clickInShell(page, 'atlas-button[name="redo"]');
    await expect.poll(async () => (await listEditor(page, 'editor-blank')).length).toBe(1);
  });
});

// ── multi-select ────────────────────────────────────────────────────

test.describe('authoring.page-editor — multi-select', () => {
  test('shift-click adds to selection; plain click replaces', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');
    await clickCell(page, 'w-editor-starter-main-text', 'Shift');

    const both = await page.evaluate(() => {
      const stack: Array<Document | ShadowRoot | Element> = [document];
      while (stack.length) {
        const root = stack.shift()!;
        const shell = ('querySelector' in root && root.querySelector)
          ? (root.querySelector('sandbox-page-editor') as (Element & { shadowRoot?: ShadowRoot }) | null)
          : null;
        if (shell?.shadowRoot) {
          const a = shell.shadowRoot.querySelector(
            '[data-widget-cell][data-instance-id="w-editor-starter-main-heading"]',
          );
          const b = shell.shadowRoot.querySelector(
            '[data-widget-cell][data-instance-id="w-editor-starter-main-text"]',
          );
          if (a && b) {
            return {
              a: a.getAttribute('data-multi-selected'),
              b: b.getAttribute('data-multi-selected'),
            };
          }
        }
        const all = ('querySelectorAll' in root && root.querySelectorAll) ? root.querySelectorAll('*') : [];
        for (const e of all) {
          const node = e as Element & { shadowRoot?: ShadowRoot };
          if (node.shadowRoot) stack.push(node.shadowRoot);
        }
      }
      return null;
    });
    expect(both).toEqual({ a: 'true', b: 'true' });
  });

  test('Delete key removes every selected widget', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const before = (await listEditor(page, 'editor-starter')).length;

    await clickCell(page, 'w-editor-starter-main-heading');
    await clickCell(page, 'w-editor-starter-main-text', 'Shift');
    await page.keyboard.press('Delete');

    await expect.poll(async () => (await listEditor(page, 'editor-starter')).length).toBe(before - 2);
  });
});

// ── live preview ────────────────────────────────────────────────────

test.describe('authoring.page-editor — live preview', () => {
  test('preview toggle opens and closes the pane', async ({ page }) => {
    await openEditor(page, 'editor-starter');

    const isOpen = async (): Promise<boolean | null> =>
      page.evaluate(() => {
        const stack: Array<Document | ShadowRoot | Element> = [document];
        while (stack.length) {
          const root = stack.shift()!;
          const shell = ('querySelector' in root && root.querySelector)
            ? root.querySelector('sandbox-page-editor')
            : null;
          if (shell) return shell.hasAttribute('preview-open');
          const kids = ('querySelectorAll' in root && root.querySelectorAll) ? root.querySelectorAll('*') : [];
          for (const e of kids) {
            const node = e as Element & { shadowRoot?: ShadowRoot };
            if (node.shadowRoot) stack.push(node.shadowRoot);
          }
        }
        return null;
      });

    expect(await isOpen()).toBe(false);
    await clickInShell(page, 'atlas-button[name="toggle-preview"]');
    await expect.poll(isOpen).toBe(true);
    await clickInShell(page, 'atlas-button[name="toggle-preview"]');
    await expect.poll(isOpen).toBe(false);
  });
});
