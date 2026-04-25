/**
 * authoring.page-editor — Playwright coverage.
 *
 * Covers the route-level surface (picker mount/remount) and the inner
 * `<authoring-page-editor-shell>` whose three modes (structure / content /
 * preview), drawer state machine, undo/redo, and selection behaviour are
 * exercised through both DOM assertions and the imperative editor API.
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
 * for the given pageId (two shadow roots deep).
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

interface ShellSnapshot {
  pageId: string;
  mode: string;
  drawer: { kind: string; widgetInstanceId?: string };
  selectedWidgetInstanceIds: string[];
  status: string;
  history: { canUndo: boolean; canRedo: boolean };
  regions: Array<{ name: string; widgetIds: string[] }>;
  widgetInstances: Array<{ instanceId: string; widgetId: string }>;
}

async function readShellSnapshot(page: Page): Promise<ShellSnapshot | null> {
  return page.evaluate(() => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('authoring-page-editor-shell') as
        (Element & { getEditorSnapshot?: () => unknown }) | null;
      if (el && typeof el.getEditorSnapshot === 'function') {
        const snap = el.getEditorSnapshot() as Record<string, unknown> | null;
        if (!snap) return null;
        return {
          pageId: snap['pageId'],
          mode: snap['mode'],
          drawer: snap['drawer'],
          selectedWidgetInstanceIds: snap['selectedWidgetInstanceIds'],
          status: snap['status'],
          history: snap['history'],
          regions: snap['regions'],
          widgetInstances: (snap['widgetInstances'] as Array<{ instanceId: string; widgetId: string }>).map(
            (w) => ({ instanceId: w.instanceId, widgetId: w.widgetId }),
          ),
        } as unknown as ShellSnapshot;
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

async function shellShadowQuery(
  page: Page,
  selector: string,
): Promise<{ ok: boolean; text?: string | null }> {
  return page.evaluate((sel: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('authoring-page-editor-shell') as
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

async function shellShadowAttr(
  page: Page,
  selector: string,
  attr: string,
): Promise<string | null> {
  return page.evaluate(({ sel, attr }: { sel: string; attr: string }) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('authoring-page-editor-shell') as
        (Element & { shadowRoot?: ShadowRoot }) | null;
      if (el?.shadowRoot) {
        const hit = el.shadowRoot.querySelector(sel);
        if (hit) return hit.getAttribute(attr);
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    return null;
  }, { sel: selector, attr });
}

async function shellHostAttr(page: Page, attr: string): Promise<string | null> {
  return page.evaluate((attr: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('authoring-page-editor-shell');
      if (el) return el.getAttribute(attr);
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    return null;
  }, attr);
}

async function clickInShell(page: Page, selector: string): Promise<void> {
  const handle: JSHandle<Element | null> = await page.evaluateHandle((sel: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('authoring-page-editor-shell') as
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
      const shell = root.querySelector('authoring-page-editor-shell') as
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

async function setMode(page: Page, mode: 'structure' | 'content' | 'preview'): Promise<void> {
  await page.evaluate((m: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('authoring-page-editor-shell') as
        (Element & { editorState?: { setMode: (m: string) => void } }) | null;
      if (el?.editorState) {
        el.editorState.setMode(m);
        return;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
  }, mode);
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

  test('shell mounts with topbar, canvas, drawer (default content mode)', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    expect((await shellShadowQuery(page, 'atlas-box[data-role="topbar"]')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'atlas-box[data-role="canvas"]')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'atlas-box[data-role="drawer"]')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'atlas-box[data-role="nav"]')).ok).toBe(true);
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('content');
  });
});

// ── shell + seed ────────────────────────────────────────────────────

test.describe('authoring.page-editor — shell + seed', () => {
  test('starter renders the seeded widgets', async ({ page }) => {
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

  test('save-status starts as "saved"', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const status = await shellShadowQuery(page, 'atlas-text[name="save-status"]');
    expect(status.text?.trim()).toBe('saved');
  });

  test('topbar exposes auto-test-ids for save / undo / redo / preview-toggle', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    expect(await shellShadowAttr(page, 'atlas-button[name="save"]', 'data-testid')).toBe(
      'authoring.page-editor.shell.save',
    );
    expect(await shellShadowAttr(page, 'atlas-button[name="undo"]', 'data-testid')).toBe(
      'authoring.page-editor.shell.undo',
    );
    expect(await shellShadowAttr(page, 'atlas-button[name="redo"]', 'data-testid')).toBe(
      'authoring.page-editor.shell.redo',
    );
    expect(
      await shellShadowAttr(page, 'atlas-button[name="preview-toggle"]', 'data-testid'),
    ).toBe('authoring.page-editor.shell.preview-toggle');
  });
});

// ── multi-select ────────────────────────────────────────────────────

test.describe('authoring.page-editor — multi-select', () => {
  test('shift-click adds to selection; plain click replaces', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');
    await clickCell(page, 'w-editor-starter-main-text', 'Shift');

    await expect.poll(async () => {
      const snap = await readShellSnapshot(page);
      return snap?.selectedWidgetInstanceIds.slice().sort();
    }).toEqual(
      ['w-editor-starter-main-heading', 'w-editor-starter-main-text'].sort(),
    );
  });

  test('Delete key removes every selected widget', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const before = (await listEditor(page, 'editor-starter')).length;

    await clickCell(page, 'w-editor-starter-main-heading');
    await clickCell(page, 'w-editor-starter-main-text', 'Shift');
    await page.keyboard.press('Delete');

    await expect
      .poll(async () => (await listEditor(page, 'editor-starter')).length)
      .toBe(before - 2);
  });
});

// ── add via imperative API + reasons ───────────────────────────────

test.describe('authoring.page-editor — adding widgets', () => {
  test('editor.add commits to the document', async ({ page }) => {
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

  test('unknown widget id returns reason=unknown-widget', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'does.not.exist',
      region: 'main',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unknown-widget');
  });

  test('invalid region returns reason=region-invalid', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'no-such-region',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('region-invalid');
  });
});

// ── acceptance: 5 required tests ───────────────────────────────────

test.describe('authoring.page-editor — acceptance', () => {
  test('1) switching modes updates the editor shell correctly', async ({ page }) => {
    await openEditor(page, 'editor-starter');

    // default: content
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('content');
    expect((await shellShadowQuery(page, 'atlas-box[data-role="nav"]')).ok).toBe(true);
    expect(await shellShadowAttr(page, 'atlas-box[data-role="drawer"]', 'data-drawer-kind')).toBe(
      'palette',
    );

    // switch to structure
    await setMode(page, 'structure');
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('structure');
    await expect
      .poll(() => shellShadowAttr(page, 'atlas-box[data-role="drawer"]', 'data-drawer-kind'))
      .not.toBe('closed');
    expect(
      (await shellShadowQuery(page, 'atlas-stack[name="template-drawer-content"]')).ok,
    ).toBe(true);

    // switch to preview
    await setMode(page, 'preview');
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('preview');
  });

  test('2) adding a widget creates a committed widget instance in the page document', async ({
    page,
  }) => {
    await openEditor(page, 'editor-blank');
    const before = (await listEditor(page, 'editor-blank')).length;
    expect(before).toBe(0);

    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'main',
      config: { level: 2, text: 'Acceptance add' },
    });
    expect(res.ok).toBe(true);

    const list = await listEditor(page, 'editor-blank');
    expect(list.length).toBe(1);
    expect(list[0]!.widgetId).toBe('sandbox.heading');

    // Confirm the controller's snapshot also reflects the new widget instance
    // (i.e. the document model picked up the change, not just the DOM).
    await expect.poll(async () => {
      const snap = await readShellSnapshot(page);
      return snap?.widgetInstances.length ?? 0;
    }).toBe(1);
  });

  test('3) selecting a widget opens the settings drawer', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await clickCell(page, 'w-editor-starter-main-heading');

    await expect
      .poll(async () => (await readShellSnapshot(page))?.drawer?.kind)
      .toBe('settings');
    await expect
      .poll(async () => (await readShellSnapshot(page))?.drawer?.widgetInstanceId)
      .toBe('w-editor-starter-main-heading');

    expect(
      (await shellShadowQuery(page, 'atlas-stack[name="settings-drawer-content"]')).ok,
    ).toBe(true);
    expect(
      (await shellShadowQuery(page, 'page-editor-property-panel[name="property-panel"]')).ok,
    ).toBe(true);
  });

  test('4) preview mode hides editor-only controls', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await setMode(page, 'preview');

    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('preview');

    // rail hidden
    const navHidden = await page.evaluate(() => {
      const stack: Array<Document | ShadowRoot | Element> = [document];
      while (stack.length) {
        const root = stack.shift()!;
        if (!('querySelector' in root) || !root.querySelector) continue;
        const el = root.querySelector('authoring-page-editor-shell') as
          (Element & { shadowRoot?: ShadowRoot }) | null;
        if (el?.shadowRoot) {
          const nav = el.shadowRoot.querySelector('atlas-box[data-role="nav"]') as HTMLElement | null;
          if (nav) {
            const cs = getComputedStyle(nav);
            return cs.display === 'none';
          }
        }
        const all = root.querySelectorAll('*');
        for (const e of all) {
          const node = e as Element & { shadowRoot?: ShadowRoot };
          if (node.shadowRoot) stack.push(node.shadowRoot);
        }
      }
      return null;
    });
    expect(navHidden).toBe(true);

    // drawer hidden via state
    expect(
      await shellShadowAttr(page, 'atlas-box[data-role="drawer"]', 'data-drawer-kind'),
    ).toBe('closed');

    // exit-preview visible
    const exitVisible = await page.evaluate(() => {
      const stack: Array<Document | ShadowRoot | Element> = [document];
      while (stack.length) {
        const root = stack.shift()!;
        if (!('querySelector' in root) || !root.querySelector) continue;
        const el = root.querySelector('authoring-page-editor-shell') as
          (Element & { shadowRoot?: ShadowRoot }) | null;
        if (el?.shadowRoot) {
          const btn = el.shadowRoot.querySelector(
            'atlas-button[name="exit-preview"]',
          ) as HTMLElement | null;
          if (btn) {
            const cs = getComputedStyle(btn);
            return cs.display !== 'none';
          }
        }
        const all = root.querySelectorAll('*');
        for (const e of all) {
          const node = e as Element & { shadowRoot?: ShadowRoot };
          if (node.shadowRoot) stack.push(node.shadowRoot);
        }
      }
      return null;
    });
    expect(exitVisible).toBe(true);
  });

  test('5) undo / redo round-trip the page document state', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const res = await runEditorOp(page, 'editor-blank', 'add', {
      widgetId: 'sandbox.heading',
      region: 'main',
      config: { level: 2, text: 'undo-roundtrip' },
    });
    expect(res.ok).toBe(true);
    await expect
      .poll(async () => (await listEditor(page, 'editor-blank')).length)
      .toBe(1);

    await clickInShell(page, 'atlas-button[name="undo"]');
    await waitForEditor(page, 'editor-blank');
    await expect
      .poll(async () => (await listEditor(page, 'editor-blank')).length)
      .toBe(0);

    await clickInShell(page, 'atlas-button[name="redo"]');
    await waitForEditor(page, 'editor-blank');
    await expect
      .poll(async () => (await listEditor(page, 'editor-blank')).length)
      .toBe(1);
  });
});
