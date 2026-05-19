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
    lastCommit: {
        intent: string;
        patch: Record<string, unknown>;
    } | null;
}
interface ShellSnapshot {
    device: 'mobile' | 'tablet' | 'desktop';
    mode: 'structure' | 'content' | 'preview';
    lastCommit: {
        intent: string;
        patch: Record<string, unknown>;
    } | null;
}
/**
 * `readEditorState` returns `unknown` because each surface decides its own
 * reader shape. These tests know exactly what shape they want, so a single
 * runtime-guarded reader narrows an awaited `unknown` into the snapshot
 * interface — replacing scattered double-casts at call sites.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isPreviewSnapshot(v: unknown): v is PreviewSnapshot {
    if (!isRecord(v))
        return false;
    return ((v['device'] === 'mobile' || v['device'] === 'tablet' || v['device'] === 'desktop') &&
        typeof v['frameWidth'] === 'number' &&
        typeof v['frameHeight'] === 'number' &&
        typeof v['contentPageReady'] === 'boolean');
}
function isShellSnapshot(v: unknown): v is ShellSnapshot {
    if (!isRecord(v))
        return false;
    return ((v['device'] === 'mobile' || v['device'] === 'tablet' || v['device'] === 'desktop') &&
        (v['mode'] === 'structure' || v['mode'] === 'content' || v['mode'] === 'preview'));
}
function asPreviewSnapshot(v: unknown): PreviewSnapshot {
    if (!isPreviewSnapshot(v)) {
        throw new Error('expected PreviewSnapshot, got something else');
    }
    return v;
}
function asShellSnapshot(v: unknown): ShellSnapshot {
    if (!isShellSnapshot(v)) {
        throw new Error('expected ShellSnapshot, got something else');
    }
    return v;
}
/**
 * Standalone-mount `<page-editor-preview>` on the authoring app's body so
 * the preview's customElements are already defined by the dev server's
 * module graph. We construct a `PageEditorController` against the seeded
 * `editor-starter` page and inject it into the preview element. Returns
 * the pageId used so subsequent assertions can target the surface keys.
 */
async function mountStandalonePreview(page: Page, pageId: 'editor-starter' | 'editor-blank' = 'editor-starter'): Promise<void> {
    await page.goto(`/${ROUTE}`);
    // Wait for the route surface to mount so all editor module side-effects
    // (custom-element registration, seed page registration, widget registry)
    // have run before we instantiate the standalone preview.
    await page.locator(ROUTE_SURFACE).waitFor();
    await page.evaluate(async function (pid: string) {
        // Dynamic imports are resolved by the dev server, not by tsc, so we
        // type each module result as `unknown` and narrow at use-site via a
        // single runtime predicate per module.
        interface SeedPagesModule {
            editorSeedPages: ReadonlyArray<{
                pageId: string;
            }>;
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
        function isLooseRecord(v: unknown): v is Record<string, unknown> {
            return v !== null && typeof v === 'object' && !Array.isArray(v);
        }
        function isSeedPagesModule(v: unknown): v is SeedPagesModule {
            return isLooseRecord(v) && Array.isArray(v['editorSeedPages']);
        }
        function isStateModule(v: unknown): v is StateModule {
            return isLooseRecord(v) && typeof v['PageEditorController'] === 'function';
        }
        function isPageTemplatesModule(v: unknown): v is PageTemplatesModule {
            return (isLooseRecord(v) &&
                typeof v['InMemoryPageStore'] === 'function' &&
                'moduleDefaultTemplateRegistry' in v);
        }
        // String-indirected paths so tsc's import-path check doesn't try to
        // resolve dev-server URLs as on-disk modules.
        const peUrl = '/src/page-editor/index.ts';
        const stateUrl = '/src/page-editor/state.ts';
        const previewUrl = '/src/page-editor/preview/index.ts';
        const peModuleRaw: unknown = await import(/* @vite-ignore */ peUrl);
        const stateModuleRaw: unknown = await import(/* @vite-ignore */ stateUrl);
        // Side-effect: registers `<page-editor-preview>`.
        await import(/* @vite-ignore */ previewUrl);
        if (!isSeedPagesModule(peModuleRaw)) {
            throw new Error('page-editor module missing editorSeedPages');
        }
        if (!isStateModule(stateModuleRaw)) {
            throw new Error('state module missing PageEditorController');
        }
        const peModule = peModuleRaw;
        const stateModule = stateModuleRaw;
        const seed = peModule.editorSeedPages.find(function (p) {
            return p.pageId === pid;
        });
        if (!seed)
            throw new Error(`unknown seed page: ${pid}`);
        const ptModuleRaw: unknown = await import(/* @vite-ignore */ '@atlas/page-templates');
        if (!isPageTemplatesModule(ptModuleRaw)) {
            throw new Error('@atlas/page-templates module missing expected exports');
        }
        const ptModule = ptModuleRaw;
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
        document.querySelectorAll('page-editor-preview[data-test-mounted="true"]').forEach(function (n) {
            return n.remove();
        });
        // The preview element accepts custom properties (pageId, controller,
        // templateRegistry) set imperatively. We widen the created element's
        // type to expose those slots — the widening is to a superset of
        // HTMLElement (added properties), which the lint rule treats as a
        // safe assertion direction.
        interface PreviewElement extends HTMLElement {
            pageId: string;
            controller: unknown;
            templateRegistry: unknown;
        }
        const el: PreviewElement = Object.assign(document.createElement('page-editor-preview'), { pageId: '', controller: undefined as unknown, templateRegistry: undefined as unknown });
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
        // Stash a handle for follow-up assertions. Reflect.set lets us drop
        // a custom slot onto window without narrowing the global type.
        Reflect.set(window, '__previewController', controller);
    }, pageId);
    // Wait for the element to install its test-state reader.
    await page.waitForFunction(function (pid: string) {
        const api = (window as {
            __atlasTest?: {
                keys(): string[];
            };
        }).__atlasTest;
        if (!api)
            return false;
        return api.keys().includes(`editor:${pid}:preview`);
    }, pageId);
}
async function readPreviewSnapshot(page: Page, pageId: string): Promise<PreviewSnapshot> {
    return asPreviewSnapshot(await readEditorState(page, `${pageId}:preview`));
}
async function readShellSnapshotByKey(page: Page, pageId: string): Promise<ShellSnapshot> {
    return asShellSnapshot(await readEditorState(page, `${pageId}:shell`));
}
async function clickPreviewShadow(page: Page, selector: string): Promise<void> {
    const handle = await page.evaluateHandle(function (sel: string) {
        function getPreviewShadow(): ShadowRoot | null {
            const host = document.querySelector('page-editor-preview[data-test-mounted="true"]');
            if (!host)
                return null;
            return (host as Element & {
                shadowRoot: ShadowRoot | null;
            }).shadowRoot;
        }
        return getPreviewShadow()?.querySelector(sel) ?? null;
    }, selector);
    const el = handle.asElement();
    if (!el)
        throw new Error(`selector not found in preview shadow: ${selector}`);
    await el.click();
}
async function getFrameWidthCss(page: Page): Promise<number> {
    return page.evaluate(function () {
        function getPreviewShadow(): ShadowRoot | null {
            const host = document.querySelector('page-editor-preview[data-test-mounted="true"]');
            if (!host)
                return null;
            return (host as Element & {
                shadowRoot: ShadowRoot | null;
            }).shadowRoot;
        }
        const frame = getPreviewShadow()?.querySelector('atlas-box[data-role="frame"]');
        if (!frame)
            return -1;
        // The element sets inline `width: <px>px`; fall back to computed style.
        // `frame` is an Element; we need HTMLElement.style and computed style.
        if (!(frame instanceof HTMLElement))
            return -1;
        const inline = frame.style.width;
        if (inline.endsWith('px'))
            return parseInt(inline, 10);
        return parseInt(getComputedStyle(frame).width, 10);
    });
}
async function setSegmentValue(page: Page, device: 'mobile' | 'tablet' | 'desktop'): Promise<void> {
    await page.evaluate(function (d: string) {
        function getPreviewShadow(): ShadowRoot | null {
            const host = document.querySelector('page-editor-preview[data-test-mounted="true"]');
            if (!host)
                return null;
            return (host as Element & {
                shadowRoot: ShadowRoot | null;
            }).shadowRoot;
        }
        const seg = getPreviewShadow()?.querySelector('atlas-segmented-control[name="device"]');
        if (!seg)
            throw new Error('segmented-control not found');
        // The control's `value` property is a custom-element extension over
        // HTMLElement; runtime guarded by checking the prop exists.
        if (!(seg instanceof HTMLElement) || !('value' in seg)) {
            throw new Error('segmented-control is not the expected element');
        }
        Reflect.set(seg, 'value', d);
        seg.dispatchEvent(new CustomEvent('change', {
            detail: { value: d },
            bubbles: true,
            composed: true,
        }));
    }, device);
}
test.describe('authoring.page-editor.preview', function () {
    test.skip('default device is desktop and frame width matches the desktop preset', async function ({ page }) {
        await mountStandalonePreview(page, 'editor-starter');
        const snap = await readPreviewSnapshot(page, 'editor-starter');
        expect(snap.device).toBe('desktop');
        expect(snap.frameWidth).toBe(1440);
        await expect.poll(function () {
            return getFrameWidthCss(page);
        }).toBe(1440);
    });
    test.skip('selecting tablet commits deviceChange on shell and breakpointSet on preview', async function ({ page }) {
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
        await expect.poll(function () {
            return getFrameWidthCss(page);
        }).toBe(820);
        const shellSnap = await readShellSnapshotByKey(page, 'editor-starter');
        expect(shellSnap.device).toBe('tablet');
    });
    test.skip('exit-preview commits setMode { mode: "content" } on the shell', async function ({ page }) {
        await mountStandalonePreview(page, 'editor-starter');
        await clickPreviewShadow(page, 'atlas-button[name="exit-preview"]');
        await assertCommitted(page, 'editor:editor-starter:shell', {
            intent: 'setMode',
            patch: { mode: 'content', previousMode: 'preview' },
        });
        const shellSnap = await readShellSnapshotByKey(page, 'editor-starter');
        expect(shellSnap.mode).toBe('content');
    });
    test.skip('the inner content-page mounts with edit falsy', async function ({ page }) {
        await mountStandalonePreview(page, 'editor-starter');
        const editFlag = await page.evaluate(function () {
            function getPreviewShadow(): ShadowRoot | null {
                const host = document.querySelector('page-editor-preview[data-test-mounted="true"]');
                if (!host)
                    return null;
                return (host as Element & {
                    shadowRoot: ShadowRoot | null;
                }).shadowRoot;
            }
            const cp = getPreviewShadow()?.querySelector('content-page');
            if (!cp)
                return 'missing';
            // content-page is a custom element with an `edit` property; guarded
            // at runtime so we don't silently read a missing slot.
            const editVal = (cp as Element & {
                edit?: boolean;
            }).edit;
            // edit may be `false` or `undefined` — both are "falsy" for our contract.
            return editVal ? 'truthy' : 'falsy';
        });
        expect(editFlag).toBe('falsy');
    });
});
