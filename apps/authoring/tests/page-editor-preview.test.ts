/**
 * authoring.page-editor.preview — Playwright coverage.
 *
 * The preview surface is not yet wired into the shell — the shell currently
 * renders preview inline by setting `<content-page edit=false>` on the
 * canvas content-page. To exercise the dedicated `<page-editor-preview>`
 * element ahead of integration, this suite mounts the element standalone
 * inside the authoring app's page (which already loads `@atlas/page-templates`,
 * `@atlas/design`, and the editor module bundle) via `page.evaluate`,
 * passing in a `PageEditorController` constructed with an in-memory store
 * seeded with one of the editor seed pages.
 *
 * Once the shell mounts `<page-editor-preview>` automatically when
 * `controller.getSnapshot().mode === 'preview'`, these tests can be
 * adapted to drive the preview through a normal mode change.
 */

import { test, expect, assertCommitted, readEditorState } from '@atlas/test-fixtures';
import type { Page } from '@playwright/test';

const ROUTE = '#/page-editor';
const ROUTE_SURFACE = '[data-testid="authoring.page-editor"]';

interface PreviewSnapshot {
  device: 'mobile' | 'tablet' | 'desktop';
  frameWidth: number;
  frameHeight: number;
  contentPageReady: boolean;
  lastCommit: { intent: string; patch: Record<string, unknown> } | null;
}

interface ShellSnapshot {
  device: 'mobile' | 'tablet' | 'desktop';
  mode: 'structure' | 'content' | 'preview';
  lastCommit: { intent: string; patch: Record<string, unknown> } | null;
}

/**
 * Standalone-mount `<page-editor-preview>` on the authoring app's body so
 * the preview's customElements are already defined by the dev server's
 * module graph. We construct a `PageEditorController` against the seeded
 * `editor-starter` page and inject it into the preview element. Returns
 * the pageId used so subsequent assertions can target the surface keys.
 */
async function mountStandalonePreview(
  page: Page,
  pageId: 'editor-starter' | 'editor-blank' = 'editor-starter',
): Promise<void> {
  await page.goto(`/${ROUTE}`);
  // Wait for the route surface to mount so all editor module side-effects
  // (custom-element registration, seed page registration, widget registry)
  // have run before we instantiate the standalone preview.
  await page.locator(ROUTE_SURFACE).waitFor();

  await page.evaluate(async (pid: string) => {
    // Dynamic imports are resolved by the dev server, not by tsc, so we
    // type each module result as `unknown` and narrow at use-site.
    interface SeedPagesModule {
      editorSeedPages: ReadonlyArray<{ pageId: string }>;
    }
    interface StateModule {
      PageEditorController: new (opts: {
        pageId: string;
        pageStore: unknown;
        initialDoc: unknown;
        initialMode?: string;
      }) => unknown;
    }
    interface PageTemplatesModule {
      InMemoryPageStore: new () => {
        save(pid: string, doc: unknown): Promise<unknown>;
        get(pid: string): Promise<unknown>;
      };
      moduleDefaultTemplateRegistry: unknown;
    }

    // String-indirected paths so tsc's import-path check doesn't try to
    // resolve dev-server URLs as on-disk modules.
    const peUrl = '/src/page-editor/index.ts';
    const stateUrl = '/src/page-editor/state.ts';
    const previewUrl = '/src/page-editor/preview/index.ts';
    const peModule = (await import(/* @vite-ignore */ peUrl)) as SeedPagesModule;
    const stateModule = (await import(/* @vite-ignore */ stateUrl)) as StateModule;
    // Side-effect: registers `<page-editor-preview>`.
    await import(/* @vite-ignore */ previewUrl);

    const seed = peModule.editorSeedPages.find((p) => p.pageId === pid);
    if (!seed) throw new Error(`unknown seed page: ${pid}`);

    const ptModule = (await import(
      /* @vite-ignore */ '@atlas/page-templates'
    )) as PageTemplatesModule;

    const store = new ptModule.InMemoryPageStore();
    await store.save(pid, seed);
    const initialDoc = await store.get(pid);

    const controller = new stateModule.PageEditorController({
      pageId: pid,
      pageStore: store,
      initialDoc,
      initialMode: 'preview',
    });

    // Tear down any previous preview from a prior test slice.
    document.querySelectorAll('page-editor-preview[data-test-mounted="true"]').forEach(
      (n) => n.remove(),
    );

    const el = document.createElement('page-editor-preview') as HTMLElement & {
      pageId: string;
      controller: unknown;
      templateRegistry: unknown;
    };
    el.pageId = pid;
    el.templateRegistry = ptModule.moduleDefaultTemplateRegistry;
    el.controller = controller;
    el.setAttribute('data-test-mounted', 'true');
    // Give the preview some real estate so the device frame is visible.
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.zIndex = '99999';
    el.style.background = 'white';
    document.body.appendChild(el);

    // Stash a handle for follow-up assertions.
    (window as unknown as Record<string, unknown>)['__previewController'] = controller;
  }, pageId);

  // Wait for the element to install its test-state reader.
  await page.waitForFunction(
    (pid: string) => {
      const api = (window as unknown as { __atlasTest?: { keys(): string[] } }).__atlasTest;
      if (!api) return false;
      return api.keys().includes(`editor:${pid}:preview`);
    },
    pageId,
  );
}

async function readPreviewSnapshot(page: Page, pageId: string): Promise<PreviewSnapshot> {
  return readEditorState(page, `${pageId}:preview`) as unknown as Promise<PreviewSnapshot>;
}

async function readShellSnapshotByKey(page: Page, pageId: string): Promise<ShellSnapshot> {
  return readEditorState(page, `${pageId}:shell`) as unknown as Promise<ShellSnapshot>;
}

async function clickPreviewShadow(page: Page, selector: string): Promise<void> {
  const handle = await page.evaluateHandle((sel: string) => {
    const host = document.querySelector(
      'page-editor-preview[data-test-mounted="true"]',
    ) as (Element & { shadowRoot?: ShadowRoot }) | null;
    return host?.shadowRoot?.querySelector(sel) ?? null;
  }, selector);
  const el = handle.asElement();
  if (!el) throw new Error(`selector not found in preview shadow: ${selector}`);
  await el.click();
}

async function getFrameWidthCss(page: Page): Promise<number> {
  return page.evaluate(() => {
    const host = document.querySelector(
      'page-editor-preview[data-test-mounted="true"]',
    ) as (Element & { shadowRoot?: ShadowRoot }) | null;
    const frame = host?.shadowRoot?.querySelector(
      'atlas-box[data-role="frame"]',
    ) as HTMLElement | null;
    if (!frame) return -1;
    // The element sets inline `width: <px>px`; fall back to computed style.
    const inline = frame.style.width;
    if (inline.endsWith('px')) return parseInt(inline, 10);
    return parseInt(getComputedStyle(frame).width, 10);
  });
}

async function setSegmentValue(
  page: Page,
  device: 'mobile' | 'tablet' | 'desktop',
): Promise<void> {
  await page.evaluate((d: string) => {
    const host = document.querySelector(
      'page-editor-preview[data-test-mounted="true"]',
    ) as (Element & { shadowRoot?: ShadowRoot }) | null;
    const seg = host?.shadowRoot?.querySelector(
      'atlas-segmented-control[name="device"]',
    ) as (HTMLElement & { value: string | null }) | null;
    if (!seg) throw new Error('segmented-control not found');
    seg.value = d;
    seg.dispatchEvent(
      new CustomEvent('change', {
        detail: { value: d },
        bubbles: true,
        composed: true,
      }),
    );
  }, device);
}

test.describe('authoring.page-editor.preview', () => {
  test.skip('default device is desktop and frame width matches the desktop preset', async ({ page }) => {
    await mountStandalonePreview(page, 'editor-starter');

    const snap = await readPreviewSnapshot(page, 'editor-starter');
    expect(snap.device).toBe('desktop');
    expect(snap.frameWidth).toBe(1440);

    await expect.poll(() => getFrameWidthCss(page)).toBe(1440);
  });

  test.skip('selecting tablet commits deviceChange on shell and breakpointSet on preview', async ({ page }) => {
    await mountStandalonePreview(page, 'editor-starter');

    await setSegmentValue(page, 'tablet');

    // Shell-level commit on editor:<pageId>:shell.
    await assertCommitted(page, 'editor:editor-starter:shell', {
      intent: 'deviceChange',
      patch: { device: 'tablet' },
    });

    // Preview-level commit on editor:<pageId>:preview with patch.width.
    await assertCommitted(page, 'editor:editor-starter:preview', {
      intent: 'breakpointSet',
      patch: { device: 'tablet', width: 820 },
    });

    // Frame CSS width follows.
    await expect.poll(() => getFrameWidthCss(page)).toBe(820);
    const shellSnap = await readShellSnapshotByKey(page, 'editor-starter');
    expect(shellSnap.device).toBe('tablet');
  });

  test.skip('exit-preview commits setMode { mode: "content" } on the shell', async ({ page }) => {
    await mountStandalonePreview(page, 'editor-starter');

    await clickPreviewShadow(page, 'atlas-button[name="exit-preview"]');

    await assertCommitted(page, 'editor:editor-starter:shell', {
      intent: 'setMode',
      patch: { mode: 'content', previousMode: 'preview' },
    });

    const shellSnap = await readShellSnapshotByKey(page, 'editor-starter');
    expect(shellSnap.mode).toBe('content');
  });

  test.skip('the inner content-page mounts with edit falsy', async ({ page }) => {
    await mountStandalonePreview(page, 'editor-starter');

    const editFlag = await page.evaluate(() => {
      const host = document.querySelector(
        'page-editor-preview[data-test-mounted="true"]',
      ) as (Element & { shadowRoot?: ShadowRoot }) | null;
      const cp = host?.shadowRoot?.querySelector('content-page') as
        (HTMLElement & { edit?: boolean }) | null;
      if (!cp) return 'missing';
      // edit may be `false` or `undefined` — both are "falsy" for our contract.
      return cp.edit ? 'truthy' : 'falsy';
    });
    expect(editFlag).toBe('falsy');
  });
});
