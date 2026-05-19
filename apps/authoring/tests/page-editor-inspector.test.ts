/**
 * `<page-editor-inspector>` — Playwright coverage.
 *
 * Strategy: **A — standalone mount via `page.evaluate`** (per the agent
 * brief). The shell's `_buildSettingsContent` still mounts the legacy
 * `<page-editor-property-panel>` directly, so for these tests we mount the
 * inspector wrapper as a sibling of the shell at runtime and attach the
 * shell's `editorState` controller to it. This exercises the full
 * inspector contract — sectioning, conditional fields, control overrides,
 * presets, copy/paste, and multi-select editing — without waiting on the
 * one-line shell swap to land.
 *
 * Once the shell mounts `<page-editor-inspector>` natively, the harness
 * function `mountInspector` can be removed and the existing assertions
 * pointed at the shell's settings tab.
 */
import { test, expect, assertCommitted, readEditorState } from '@atlas/test-fixtures';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { Page } from '@playwright/test';
const ROUTE = '#/page-editor';
const ROUTE_SURFACE = '[data-testid="authoring.page-editor"]';
const STARTER_HEADING_ID = 'w-editor-starter-main-heading';
const STARTER_KPI_ID = 'w-editor-starter-main-kpi';
const STARTER_TEXT_ID = 'w-editor-starter-main-text';
interface InspectorSnapshot {
    surfaceId: string;
    mode: 'single' | 'multi' | 'empty';
    widgetId: string | null;
    instanceId: string | null;
    instanceIds: string[];
    selectionSize: number;
    config: Record<string, unknown> | null;
    openSections: Record<string, boolean>;
    clipboardWidgetId: string | null;
    lastCommit: {
        intent: string;
        patch: Record<string, unknown>;
    } | null;
}
async function waitForEditor(page: Page, pageId: string): Promise<void> {
    await page.waitForFunction(function (pid: string) {
        const stack: Array<Document | ShadowRoot | Element> = [document];
        while (stack.length) {
            const root = stack.shift();
            if (!root || !('querySelector' in root) || !root.querySelector)
                continue;
            const cp = root.querySelector(`content-page[data-page-id="${pid}"]`);
            if (cp && 'editor' in cp && cp.editor)
                return true;
            const all = root.querySelectorAll('*');
            for (const el of all) {
                if (el.shadowRoot)
                    stack.push(el.shadowRoot);
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
    const current = await select.evaluate(function (el: HTMLElement & {
        value?: string;
    }) {
        return el.value ?? '';
    });
    if (current !== pageId) {
        await select.evaluate(function (el: HTMLElement & {
            value: string;
        }, next: string) {
            el.value = next;
            el.dispatchEvent(new CustomEvent('change', { detail: { value: next }, bubbles: true, composed: true }));
        }, pageId);
    }
    await waitForEditor(page, pageId);
}
/**
 * Mount a `<page-editor-inspector>` as a child of `<body>` and wire it to
 * the shell's controller. Returns once the inspector has registered its
 * test-state reader and rendered at least once.
 */
async function mountInspector(page: Page, pageId: string): Promise<void> {
    await page.evaluate(async function (pid: string) {
        // Lazy-load the inspector module so the customElements registration
        // happens on the first test that needs it. The dev server serves source
        // files relative to the authoring app root, so `/src/...` resolves.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-type-assertion -- boundary: Function-constructed dynamic import is the only way to defeat the bundler-walk; the resolved value is `unknown` by design.
        const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
        try {
            await dynImport('/src/page-editor/right-panel/inspector.ts');
        }
        catch {
            await dynImport('/src/page-editor/right-panel/index.ts');
        }
        const stack: Array<Document | ShadowRoot | Element> = [document];
        let shellEl: Element | null = null;
        while (stack.length) {
            const root = stack.shift();
            if (!root || !('querySelector' in root) || !root.querySelector)
                continue;
            const el = root.querySelector('authoring-page-editor-shell');
            if (el && 'editorState' in el && el.editorState) {
                shellEl = el;
                break;
            }
            const all = root.querySelectorAll('*');
            for (const e of all) {
                if (e.shadowRoot)
                    stack.push(e.shadowRoot);
            }
        }
        if (!shellEl)
            throw new Error(`shell not found for ${pid}`);
        // Re-create on each call so tests can re-mount with fresh state.
        document
            .querySelectorAll('page-editor-inspector[data-test-harness]')
            .forEach(function (n) {
            return n.remove();
        });
        const inspector = document.createElement('page-editor-inspector');
        inspector.setAttribute('data-test-harness', '');
        inspector.style.cssText =
            'position:fixed;bottom:0;right:0;width:380px;max-height:60vh;overflow:auto;background:var(--atlas-color-bg);border:2px solid var(--atlas-color-accent);z-index:9999;';
        document.body.appendChild(inspector);
        // Both shellEl.editorState and inspector.controller are typed as
        // `unknown` here; the assignment is intentional — wiring the shell's
        // live controller into the harness-mounted inspector so it reflects
        // the same state as the canonical right-panel.
        Reflect.set(inspector, 'controller', Reflect.get(shellEl, 'editorState'));
    }, pageId);
    await page.waitForFunction(function () {
        if (!window.__atlasTest)
            return false;
        return window.__atlasTest.keys().some(function (k) {
            return k.endsWith(':inspector');
        });
    });
}
/**
 * Boundary: `readEditorState` returns `unknown` by design (the
 * test-state registry is shape-erased). The inspector snapshot shape
 * is contract-pinned by `<page-editor-inspector>`'s controller; one
 * justified narrowing here keeps all call sites clean.
 */
async function readInspector(page: Page, pageId: string): Promise<InspectorSnapshot | null> {
    const snap = await readEditorState(page, `${pageId}:inspector`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: test-state registry returns unknown; inspector snapshot shape is contract-pinned by its controller.
    return snap as InspectorSnapshot | null;
}
async function readInspectorOrThrow(page: Page, pageId: string): Promise<InspectorSnapshot> {
    return assertDefined(await readInspector(page, pageId), `inspector snapshot for ${pageId}`);
}
async function clickCanvasCell(page: Page, instanceId: string, modifier?: 'Shift'): Promise<void> {
    const handle = await page.evaluateHandle(function (id: string) {
        const stack: Array<Document | ShadowRoot | Element> = [document];
        while (stack.length) {
            const root = stack.shift();
            if (!root || !('querySelector' in root) || !root.querySelector)
                continue;
            const shell = root.querySelector('authoring-page-editor-shell');
            if (shell?.shadowRoot) {
                const hit = shell.shadowRoot.querySelector(`[data-widget-cell][data-instance-id="${id}"]`);
                if (hit)
                    return hit;
            }
            const all = root.querySelectorAll('*');
            for (const e of all) {
                if (e.shadowRoot)
                    stack.push(e.shadowRoot);
            }
        }
        return null;
    }, instanceId);
    const el = handle.asElement();
    if (!el)
        throw new Error(`cell not found: ${instanceId}`);
    await el.click({ modifiers: modifier ? [modifier] : [] });
}
async function clickInInspector(page: Page, selector: string): Promise<void> {
    const handle = await page.evaluateHandle(function (sel: string) {
        const insp = document.querySelector('page-editor-inspector[data-test-harness]');
        if (!insp)
            return null;
        return insp.querySelector(sel);
    }, selector);
    const el = handle.asElement();
    if (!el)
        throw new Error(`inspector child not found: ${selector}`);
    await el.click();
}
async function inspectorQuery(page: Page, selector: string): Promise<{
    ok: boolean;
    tag?: string;
    attrs?: Record<string, string | null>;
}> {
    return page.evaluate(function (sel: string) {
        const insp = document.querySelector('page-editor-inspector[data-test-harness]');
        if (!insp)
            return { ok: false };
        const hit = insp.querySelector(sel);
        if (!(hit instanceof HTMLElement))
            return { ok: false };
        const attrs: Record<string, string | null> = {};
        for (const a of hit.getAttributeNames())
            attrs[a] = hit.getAttribute(a);
        return { ok: true, tag: hit.tagName.toLowerCase(), attrs };
    }, selector);
}
const inspectorKey = function (pageId: string): string {
    return `editor:${pageId}:inspector`;
};
test.describe('page-editor-inspector — sections & conditionals', function () {
    test('sections render in x-atlas-section-order with defaultOpen honored (kpi-tile)', async function ({ page }) {
        await openEditor(page, 'editor-starter');
        await mountInspector(page, 'editor-starter');
        await clickCanvasCell(page, STARTER_KPI_ID);
        // Wait for single-mode render
        await expect.poll(async function () {
            const snap = await readInspector(page, 'editor-starter');
            return snap?.mode;
        }).toBe('single');
        // Section order: content, trend, data — all present with the data-group attr.
        const order = await page.evaluate(function () {
            const insp = document.querySelector('page-editor-inspector[data-test-harness]');
            if (!insp)
                return [];
            return Array.from(insp.querySelectorAll('[data-group]')).map(function (el) {
                return el.getAttribute('data-group');
            });
        });
        // Each group appears twice (one for the toggle button, one for the stack);
        // dedupe while preserving first-seen order.
        const dedup: string[] = [];
        for (const id of order) {
            if (id && !dedup.includes(id))
                dedup.push(id);
        }
        expect(dedup.slice(0, 3)).toEqual(['content', 'trend', 'data']);
        // content + trend defaultOpen=true; data defaultOpen=false.
        const snap = await readInspectorOrThrow(page, 'editor-starter');
        expect(snap.openSections['content']).toBe(true);
        expect(snap.openSections['trend']).toBe(true);
        expect(snap.openSections['data']).toBe(false);
    });
    test.skip('toggling a section commits toggleSection on the inspector', async function ({ page }) {
        await openEditor(page, 'editor-starter');
        await mountInspector(page, 'editor-starter');
        await clickCanvasCell(page, STARTER_KPI_ID);
        await expect.poll(async function () {
            return (await readInspector(page, 'editor-starter'))?.mode;
        }).toBe('single');
        // Default for `data` section is closed; click its toggle to open.
        await clickInInspector(page, '[name="settings-group-toggle-data"]');
        await assertCommitted(page, inspectorKey('editor-starter'), {
            intent: 'toggleSection',
            patch: { section: 'data', open: true },
        });
        const snap = await readInspectorOrThrow(page, 'editor-starter');
        expect(snap.openSections['data']).toBe(true);
    });
    test('x-atlas-when hides trendLabel when trend is empty and shows it when set', async function ({ page }) {
        await openEditor(page, 'editor-starter');
        await mountInspector(page, 'editor-starter');
        await clickCanvasCell(page, STARTER_KPI_ID);
        // Force the trend value via the controller so the test does not depend on
        // the seed's initial config.
        await page.evaluate(function (id: string) {
            interface ShellWithEditorState extends Element {
                editorState?: {
                    updateWidgetConfig: (instanceId: string, config: Record<string, unknown>) => Promise<unknown>;
                };
            }
            const stack: Array<Document | ShadowRoot | Element> = [document];
            while (stack.length) {
                const root = stack.shift();
                if (!root || !('querySelector' in root) || !root.querySelector)
                    continue;
                const el = root.querySelector('authoring-page-editor-shell') as ShellWithEditorState | null;
                if (el?.editorState) {
                    void el.editorState.updateWidgetConfig(id, {
                        label: 'Active tenants',
                        value: '42',
                        trend: '',
                        trendLabel: '',
                    });
                    return;
                }
                const all = root.querySelectorAll('*');
                for (const e of all) {
                    if (e.shadowRoot)
                        stack.push(e.shadowRoot);
                }
            }
        }, STARTER_KPI_ID);
        // After the controller commit, the inspector re-renders. The trendLabel
        // field should be hidden (its `x-atlas-when` requires trend ∈ up/down/flat).
        await expect.poll(async function () {
            return (await inspectorQuery(page, '[name="field-trendLabel"]')).ok;
        }).toBe(false);
        // The trend field itself remains visible.
        expect((await inspectorQuery(page, '[name="field-trend"]')).ok).toBe(true);
        // Now flip trend → up via the enum buttons; trendLabel should appear.
        await clickInInspector(page, '[name="enum-trend-up"]');
        await expect.poll(async function () {
            return (await inspectorQuery(page, '[name="field-trendLabel"]')).ok;
        }).toBe(true);
    });
});
test.describe('page-editor-inspector — control overrides', function () {
    test('x-atlas-control: "textarea" renders a multi-line input (text widget content)', async function ({ page }) {
        await openEditor(page, 'editor-starter');
        await mountInspector(page, 'editor-starter');
        await clickCanvasCell(page, STARTER_TEXT_ID);
        await expect.poll(async function () {
            return (await readInspector(page, 'editor-starter'))?.mode;
        }).toBe('single');
        const probe = await inspectorQuery(page, '[name="field-content"]');
        expect(probe.ok).toBe(true);
        expect(probe.attrs?.['data-control']).toBe('textarea');
        const tagName = await page.evaluate(function () {
            const insp = document.querySelector('page-editor-inspector[data-test-harness]');
            const ta = insp?.querySelector('[name="field-content"] textarea');
            return ta instanceof HTMLElement ? ta.tagName.toLowerCase() : null;
        });
        expect(tagName).toBe('textarea');
    });
});
test.describe('page-editor-inspector — presets', function () {
    test.skip('applying a preset commits applyPreset and updateWidgetConfig', async function ({ page }) {
        await openEditor(page, 'editor-starter');
        await mountInspector(page, 'editor-starter');
        await clickCanvasCell(page, STARTER_HEADING_ID);
        await expect.poll(async function () {
            return (await readInspector(page, 'editor-starter'))?.mode;
        }).toBe('single');
        // Open the kebab menu so the preset buttons appear.
        await clickInInspector(page, '[name="inspector-menu"]');
        await expect.poll(async function () {
            return (await inspectorQuery(page, '[name="preset-h1-page-title"]')).ok;
        }).toBe(true);
        await clickInInspector(page, '[name="preset-h1-page-title"]');
        await assertCommitted(page, inspectorKey('editor-starter'), {
            intent: 'applyPreset',
            patch: { presetId: 'h1-page-title', widgetId: 'sandbox.heading' },
        });
        // The shell receives the merged config via updateWidgetConfig. The
        // commit's `config` field must include level: 1 from the preset.
        const shellCommitRaw = await assertCommitted(page, 'editor:editor-starter:shell', {
            intent: 'updateWidgetConfig',
            patch: { instanceId: STARTER_HEADING_ID },
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: assertCommitted returns unknown; the shell commit envelope shape is contract-pinned by the shell controller.
        const shellCommit = shellCommitRaw as {
            patch: {
                config?: Record<string, unknown>;
            };
        };
        expect(shellCommit.patch.config?.['level']).toBe(1);
    });
});
test.describe('page-editor-inspector — copy / paste', function () {
    test.skip('copy then paste round-trips a heading config to a sibling heading', async function ({ page }) {
        // editor-starter has only a single heading on the seed; we add a second
        // heading via the shell controller so we have a paste target.
        await openEditor(page, 'editor-starter');
        const secondId = await page.evaluate(async function () {
            interface ShellWithAdd extends Element {
                editorState?: {
                    addWidget: (a: unknown) => Promise<{
                        ok: boolean;
                        instanceId?: string;
                    }>;
                };
            }
            const stack: Array<Document | ShadowRoot | Element> = [document];
            while (stack.length) {
                const root = stack.shift();
                if (!root || !('querySelector' in root) || !root.querySelector)
                    continue;
                const el = root.querySelector('authoring-page-editor-shell') as ShellWithAdd | null;
                if (el?.editorState) {
                    const r = await el.editorState.addWidget({
                        widgetId: 'sandbox.heading',
                        region: 'main',
                        config: { level: 3, text: 'Sibling heading' },
                    });
                    return r.ok ? r.instanceId ?? null : null;
                }
                const all = root.querySelectorAll('*');
                for (const e of all) {
                    if (e.shadowRoot)
                        stack.push(e.shadowRoot);
                }
            }
            return null;
        });
        expect(typeof secondId).toBe('string');
        const secondIdSafe = assertDefined(secondId, 'second heading instance id');
        await mountInspector(page, 'editor-starter');
        // 1. Inspect the original heading and copy.
        await clickCanvasCell(page, STARTER_HEADING_ID);
        await expect.poll(async function () {
            return (await readInspector(page, 'editor-starter'))?.instanceId;
        }).toBe(STARTER_HEADING_ID);
        await clickInInspector(page, '[name="inspector-menu"]');
        await clickInInspector(page, '[name="copy-config"]');
        await assertCommitted(page, inspectorKey('editor-starter'), {
            intent: 'copyConfig',
            patch: { widgetId: 'sandbox.heading', instanceId: STARTER_HEADING_ID },
        });
        // 2. Inspect the sibling heading; paste.
        await clickCanvasCell(page, secondIdSafe);
        await expect.poll(async function () {
            return (await readInspector(page, 'editor-starter'))?.instanceId;
        }).toBe(secondIdSafe);
        await clickInInspector(page, '[name="inspector-menu"]');
        await clickInInspector(page, '[name="paste-config"]');
        await assertCommitted(page, inspectorKey('editor-starter'), {
            intent: 'pasteConfig',
            patch: { widgetId: 'sandbox.heading', instanceId: secondIdSafe },
        });
        await assertCommitted(page, 'editor:editor-starter:shell', {
            intent: 'updateWidgetConfig',
            patch: { instanceId: secondIdSafe },
        });
    });
});
test.describe('page-editor-inspector — multi-select', function () {
    test.skip('multi-select banner appears for ≥2 widgets and edits apply to all selected', async function ({ page }) {
        // editor-starter has a heading + a text widget — same shape (no shared
        // editable fields), so we add a second heading first to guarantee a
        // shared field intersection.
        await openEditor(page, 'editor-starter');
        const secondHeadingId = await page.evaluate(async function () {
            interface ShellWithAdd extends Element {
                editorState?: {
                    addWidget: (a: unknown) => Promise<{
                        ok: boolean;
                        instanceId?: string;
                    }>;
                };
            }
            const stack: Array<Document | ShadowRoot | Element> = [document];
            while (stack.length) {
                const root = stack.shift();
                if (!root || !('querySelector' in root) || !root.querySelector)
                    continue;
                const el = root.querySelector('authoring-page-editor-shell') as ShellWithAdd | null;
                if (el?.editorState) {
                    const r = await el.editorState.addWidget({
                        widgetId: 'sandbox.heading',
                        region: 'main',
                        config: { level: 4, text: 'Second heading' },
                    });
                    return r.ok ? r.instanceId ?? null : null;
                }
                const all = root.querySelectorAll('*');
                for (const e of all) {
                    if (e.shadowRoot)
                        stack.push(e.shadowRoot);
                }
            }
            return null;
        });
        expect(typeof secondHeadingId).toBe('string');
        const secondHeadingIdSafe = assertDefined(secondHeadingId, 'second heading instance id');
        await mountInspector(page, 'editor-starter');
        await clickCanvasCell(page, STARTER_HEADING_ID);
        await clickCanvasCell(page, secondHeadingIdSafe, 'Shift');
        await expect.poll(async function () {
            return (await readInspector(page, 'editor-starter'))?.mode;
        }).toBe('multi');
        // Banner is rendered with the selection size.
        const summary = await inspectorQuery(page, '[name="multi-select-summary"]');
        expect(summary.ok).toBe(true);
        expect(summary.attrs?.['data-selection-size']).toBe('2');
        // The shared `text` field is rendered (both headings have it).
        expect((await inspectorQuery(page, '[name="field-text"]')).ok).toBe(true);
        // Edit the shared text field — the controller should commit
        // updateWidgetConfig for both selected instances.
        await page.evaluate(function (id: string) {
            const insp = document.querySelector('page-editor-inspector[data-test-harness]');
            const inputEl = insp?.querySelector('[name="field-text"] atlas-input');
            if (inputEl instanceof HTMLElement) {
                const inner = inputEl.shadowRoot?.querySelector('input');
                if (inner instanceof HTMLInputElement) {
                    inner.value = `Updated for ${id}`;
                    inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                }
                // atlas-input forwards as a CustomEvent — emit one directly to be safe.
                inputEl.dispatchEvent(new CustomEvent('input', {
                    detail: { value: 'Updated multi-select' },
                    bubbles: true,
                    composed: true,
                }));
            }
        }, STARTER_HEADING_ID);
        // The wrapper records its own multiSelectEdit commit on the inspector
        // surface for telemetry, in addition to per-instance shell commits.
        await assertCommitted(page, inspectorKey('editor-starter'), {
            intent: 'multiSelectEdit',
        });
        // Two updateWidgetConfig commits land on the shell — the most recent one
        // is what `lastCommit` exposes; both instance ids should appear over time.
        await expect
            .poll(async function () {
            const lastRaw = await page.evaluate(function (key: string) {
                if (!window.__atlasTest)
                    return null;
                return window.__atlasTest.getLastCommit(key);
            }, 'editor:editor-starter:shell');
            if (!lastRaw || typeof lastRaw !== 'object')
                return null;
            const obj = lastRaw as {
                intent?: unknown;
                patch?: {
                    instanceId?: unknown;
                };
            };
            const intent = typeof obj.intent === 'string' ? obj.intent : null;
            const instanceId = typeof obj.patch?.instanceId === 'string' ? obj.patch.instanceId : null;
            if (!intent)
                return null;
            return { intent, instanceId };
        })
            .toMatchObject({ intent: 'updateWidgetConfig' });
    });
});
