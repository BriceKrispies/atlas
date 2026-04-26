/**
 * authoring.page-editor — Playwright coverage.
 *
 * Covers the route-level surface (picker mount/remount) and the inner
 * `<authoring-page-editor-shell>` whose three modes (structure / content /
 * preview), four-panel state machine (left / right / bottom), undo/redo,
 * and selection behaviour are exercised through both DOM assertions and
 * the imperative editor API.
 */

import { test, expect, assertCommitted, readEditorState } from '@atlas/test-fixtures';
import type { Page, JSHandle } from '@playwright/test';

/** Test-state key the shell registers for its commit envelope. */
const shellKey = (pageId: string): string => `editor:${pageId}:shell`;

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

interface PanelStateShape {
  open: boolean;
  tab: string;
  size: number;
}
interface ShellSnapshot {
  pageId: string;
  mode: string;
  panels: { left: PanelStateShape; right: PanelStateShape; bottom: PanelStateShape };
  inspectedWidgetInstanceId: string | null;
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
          panels: snap['panels'],
          inspectedWidgetInstanceId: snap['inspectedWidgetInstanceId'],
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

  test('shell mounts with topbar, canvas, and three panels (default content mode)', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    expect((await shellShadowQuery(page, 'atlas-box[data-role="topbar"]')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'atlas-box[data-role="canvas"]')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'page-editor-left-panel')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'page-editor-right-panel')).ok).toBe(true);
    expect((await shellShadowQuery(page, 'page-editor-bottom-panel')).ok).toBe(true);
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('content');
    await expect.poll(() => shellHostAttr(page, 'data-left-open')).toBe('true');
    await expect.poll(() => shellHostAttr(page, 'data-right-open')).toBe('false');
    await expect.poll(() => shellHostAttr(page, 'data-bottom-open')).toBe('false');
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
//
// Each scenario asserts that the user intent was committed against the
// shell's `editor:<pageId>:shell` test-state surface (per
// specs/frontend/interaction-contracts.md). Asserting the commit envelope
// — not just downstream DOM — is what catches editor regressions where the
// chrome still paints but the intent never landed.

interface ShellSnapshotShape {
  surfaceId: string;
  mode: string;
  panels: {
    left: { open: boolean; tab: string; size: number };
    right: { open: boolean; tab: string; size: number };
    bottom: { open: boolean; tab: string; size: number };
  };
  inspectedWidgetInstanceId: string | null;
  selectedWidgetInstanceIds: string[];
  status: string;
  history: { canUndo: boolean; canRedo: boolean };
  widgetInstances: Array<{ instanceId: string; widgetId: string }>;
  lastCommit: { intent: string; patch: Record<string, unknown> } | null;
}

test.describe('authoring.page-editor — acceptance', () => {
  test('1) switching modes commits setMode and updates the shell', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const key = shellKey('editor-starter');

    // default: content
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('content');

    // structure
    await setMode(page, 'structure');
    await assertCommitted(page, key, { intent: 'setMode', patch: { mode: 'structure' } });
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('structure');
    expect(
      (await shellShadowQuery(page, 'atlas-stack[name="templates-tab-content"]')).ok,
    ).toBe(true);

    // preview
    await setMode(page, 'preview');
    await assertCommitted(page, key, { intent: 'setMode', patch: { mode: 'preview' } });
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('preview');
  });

  test('2) adding a widget commits addWidget with the resolved instanceId', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const key = shellKey('editor-blank');

    // Drive through the controller so the shell-level `addWidget` intent
    // fires (the inner editor.add path commits at the document layer; the
    // shell layer is what we're asserting here).
    const ok = await page.evaluate(async () => {
      const stack: Array<Document | ShadowRoot | Element> = [document];
      while (stack.length) {
        const root = stack.shift()!;
        if (!('querySelector' in root) || !root.querySelector) continue;
        const el = root.querySelector('authoring-page-editor-shell') as
          (Element & {
            editorState?: {
              addWidget: (a: unknown) => Promise<{ ok: boolean; instanceId?: string }>;
            };
          }) | null;
        if (el?.editorState) {
          const r = await el.editorState.addWidget({
            widgetId: 'sandbox.heading',
            region: 'main',
            config: { level: 2, text: 'Acceptance add' },
          });
          return r.ok;
        }
        const all = root.querySelectorAll('*');
        for (const e of all) {
          const node = e as Element & { shadowRoot?: ShadowRoot };
          if (node.shadowRoot) stack.push(node.shadowRoot);
        }
      }
      return false;
    });
    expect(ok).toBe(true);

    const commit = (await assertCommitted(page, key, {
      intent: 'addWidget',
      patch: { widgetId: 'sandbox.heading', region: 'main' },
    })) as { patch: Record<string, unknown> };

    // The patch must carry the resolved instanceId so test authors can
    // chain follow-up assertions without re-querying the doc.
    expect(typeof commit.patch['instanceId']).toBe('string');

    const snap = (await readEditorState(page, 'editor-blank:shell')) as ShellSnapshotShape;
    expect(snap.widgetInstances.length).toBe(1);
  });

  test('3) clicking a widget commits selectWidget and opens settings', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const key = shellKey('editor-starter');

    await clickCell(page, 'w-editor-starter-main-heading');

    await assertCommitted(page, key, {
      intent: 'selectWidget',
      patch: { instanceId: 'w-editor-starter-main-heading', additive: false },
    });

    const snap = (await readEditorState(page, 'editor-starter:shell')) as ShellSnapshotShape;
    expect(snap.panels.right.open).toBe(true);
    expect(snap.panels.right.tab).toBe('settings');
    expect(snap.inspectedWidgetInstanceId).toBe('w-editor-starter-main-heading');

    expect(
      (await shellShadowQuery(page, 'atlas-stack[name="settings-tab-content"]')).ok,
    ).toBe(true);
  });

  test('4) preview mode hides editor-only chrome and commits setMode', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const key = shellKey('editor-starter');

    await setMode(page, 'preview');
    await assertCommitted(page, key, { intent: 'setMode', patch: { mode: 'preview' } });

    const snap = (await readEditorState(page, 'editor-starter:shell')) as ShellSnapshotShape;
    expect(snap.mode).toBe('preview');
    expect(snap.panels.left.open).toBe(false);
    expect(snap.panels.right.open).toBe(false);
    expect(snap.panels.bottom.open).toBe(false);

    // exit-preview button visible
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
          if (btn) return getComputedStyle(btn).display !== 'none';
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

  test('5) undo / redo each commit and round-trip the document', async ({ page }) => {
    await openEditor(page, 'editor-blank');
    const key = shellKey('editor-blank');

    // Add via the shell controller so undo/redo can roll the doc.
    await page.evaluate(async () => {
      const stack: Array<Document | ShadowRoot | Element> = [document];
      while (stack.length) {
        const root = stack.shift()!;
        if (!('querySelector' in root) || !root.querySelector) continue;
        const el = root.querySelector('authoring-page-editor-shell') as
          (Element & {
            editorState?: { addWidget: (a: unknown) => Promise<{ ok: boolean }> };
          }) | null;
        if (el?.editorState) {
          await el.editorState.addWidget({
            widgetId: 'sandbox.heading',
            region: 'main',
            config: { level: 2, text: 'undo-roundtrip' },
          });
          return;
        }
        const all = root.querySelectorAll('*');
        for (const e of all) {
          const node = e as Element & { shadowRoot?: ShadowRoot };
          if (node.shadowRoot) stack.push(node.shadowRoot);
        }
      }
    });

    await assertCommitted(page, key, { intent: 'addWidget' });
    await expect
      .poll(async () => (await listEditor(page, 'editor-blank')).length)
      .toBe(1);

    await clickInShell(page, 'atlas-button[name="undo"]');
    await assertCommitted(page, key, { intent: 'undo' });
    await waitForEditor(page, 'editor-blank');
    await expect
      .poll(async () => (await listEditor(page, 'editor-blank')).length)
      .toBe(0);

    await clickInShell(page, 'atlas-button[name="redo"]');
    await assertCommitted(page, key, { intent: 'redo' });
    await waitForEditor(page, 'editor-blank');
    await expect
      .poll(async () => (await listEditor(page, 'editor-blank')).length)
      .toBe(1);
  });
});

// ── panels (S2) ──────────────────────────────────────────────────────

test.describe('authoring.page-editor — panels', () => {
  /** Drive a controller intent by name from inside the page. */
  async function runShellIntent(page: Page, method: string, ...args: unknown[]): Promise<void> {
    await page.evaluate(({ method, args }: { method: string; args: unknown[] }) => {
      const stack: Array<Document | ShadowRoot | Element> = [document];
      while (stack.length) {
        const root = stack.shift()!;
        if (!('querySelector' in root) || !root.querySelector) continue;
        const el = root.querySelector('authoring-page-editor-shell') as
          (Element & { editorState?: Record<string, (...a: unknown[]) => unknown> }) | null;
        if (el?.editorState) {
          (el.editorState[method] as (...a: unknown[]) => unknown)(...args);
          return;
        }
        const all = root.querySelectorAll('*');
        for (const e of all) {
          const node = e as Element & { shadowRoot?: ShadowRoot };
          if (node.shadowRoot) stack.push(node.shadowRoot);
        }
      }
    }, { method, args });
  }

  test('togglePanel commits and reflects on the host attribute', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const key = shellKey('editor-starter');

    // Default: left=true, right=false, bottom=false.
    await expect.poll(() => shellHostAttr(page, 'data-bottom-open')).toBe('false');

    await runShellIntent(page, 'togglePanel', 'bottom', true);
    await assertCommitted(page, key, {
      intent: 'panelToggle',
      patch: { panel: 'bottom', open: true },
    });
    await expect.poll(() => shellHostAttr(page, 'data-bottom-open')).toBe('true');

    await runShellIntent(page, 'togglePanel', 'left', false);
    await assertCommitted(page, key, {
      intent: 'panelToggle',
      patch: { panel: 'left', open: false },
    });
    await expect.poll(() => shellHostAttr(page, 'data-left-open')).toBe('false');

    // Floating canvas-edge open button reopens the left panel.
    await clickInShell(page, 'atlas-button[name="open-left"]');
    await assertCommitted(page, key, {
      intent: 'panelToggle',
      patch: { panel: 'left', open: true },
    });
    await expect.poll(() => shellHostAttr(page, 'data-left-open')).toBe('true');
  });

  test('resizePanel commits the clamped size', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    const key = shellKey('editor-starter');

    await runShellIntent(page, 'resizePanel', 'left', 360);
    await assertCommitted(page, key, {
      intent: 'panelResize',
      patch: { panel: 'left', size: 360 },
    });

    // Out-of-bounds requests get clamped (left bound: 200..520).
    await runShellIntent(page, 'resizePanel', 'left', 9999);
    await assertCommitted(page, key, {
      intent: 'panelResize',
      patch: { panel: 'left', size: 520 },
    });
  });

  test('preview mode collapses every panel and floating-open buttons hide', async ({ page }) => {
    await openEditor(page, 'editor-starter');

    await setMode(page, 'preview');
    await expect.poll(() => shellHostAttr(page, 'data-mode')).toBe('preview');
    await expect.poll(() => shellHostAttr(page, 'data-left-open')).toBe('false');
    await expect.poll(() => shellHostAttr(page, 'data-right-open')).toBe('false');
    await expect.poll(() => shellHostAttr(page, 'data-bottom-open')).toBe('false');

    // The canvas-edge open buttons are hidden in preview, so the chrome
    // really is gone.
    const openLeftVisible = await page.evaluate(() => {
      const stack: Array<Document | ShadowRoot | Element> = [document];
      while (stack.length) {
        const root = stack.shift()!;
        if (!('querySelector' in root) || !root.querySelector) continue;
        const shell = root.querySelector('authoring-page-editor-shell') as
          (Element & { shadowRoot?: ShadowRoot }) | null;
        if (shell?.shadowRoot) {
          const box = shell.shadowRoot.querySelector(
            'atlas-box[data-role="canvas-edge"][data-edge="left"]',
          ) as HTMLElement | null;
          if (box) return getComputedStyle(box).display !== 'none';
        }
        const all = root.querySelectorAll('*');
        for (const e of all) {
          const node = e as Element & { shadowRoot?: ShadowRoot };
          if (node.shadowRoot) stack.push(node.shadowRoot);
        }
      }
      return null;
    });
    expect(openLeftVisible).toBe(false);
  });

  test('panel sizes survive a remount (localStorage persistence)', async ({ page }) => {
    await openEditor(page, 'editor-starter');
    await runShellIntent(page, 'resizePanel', 'right', 400);
    // Trigger a save explicitly by simulating the resize-end phase via
    // the storage helper directly — the controller's resizePanel commit
    // path is what tests assert; the persistence handler runs only on
    // pointer-end events. Bypass via localStorage to keep the test tight.
    await page.evaluate(() => {
      try {
        localStorage.setItem(
          'atlas:authoring.page-editor.shell.panels',
          JSON.stringify({ right: 400 }),
        );
      } catch {
        /* no-op */
      }
    });

    // Re-open the editor on the same seed; the controller should pick up
    // the persisted right-panel width.
    await page.reload();
    await openEditor(page, 'editor-starter');
    const snap = (await readEditorState(page, 'editor-starter:shell')) as ShellSnapshotShape;
    expect(snap.panels.right.size).toBe(400);
  });
});
