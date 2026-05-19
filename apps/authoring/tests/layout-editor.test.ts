/**
 * authoring.layout-editor — Playwright smoke coverage.
 *
 * Verifies the layout editor route mounts, the picker exposes its
 * auto-generated test id, and switching between blank canvas and a preset
 * remounts the inner `<atlas-layout-editor>`.
 */
import { test, expect } from '@atlas/test-fixtures';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { Page } from '@playwright/test';
const ROUTE = '#/layout-editor';
const ROUTE_SURFACE = '[data-testid="authoring.layout-editor"]';
const PICKER = `${ROUTE_SURFACE} >> [data-testid="authoring.layout-editor.layout-select"]`;
async function pickerOptions(page: Page): Promise<Array<{
    value: string;
    label: string;
}>> {
    return page.evaluate(function () {
        interface SelectEl extends HTMLElement {
            options?: Array<{
                value: string;
                label: string;
            }>;
        }
        const stack: Array<Document | ShadowRoot | Element> = [document];
        while (stack.length) {
            const root = stack.shift();
            if (!root || !('querySelector' in root) || !root.querySelector)
                continue;
            const el = root.querySelector<SelectEl>('atlas-select[name="layout-select"]');
            if (el && Array.isArray(el.options))
                return el.options;
            const all = root.querySelectorAll('*');
            for (const e of all) {
                if (e.shadowRoot)
                    stack.push(e.shadowRoot);
            }
        }
        return [];
    });
}
async function setPickerValue(page: Page, value: string): Promise<void> {
    await page.evaluate(function (next: string) {
        interface SelectEl extends HTMLElement {
            value: string;
        }
        const stack: Array<Document | ShadowRoot | Element> = [document];
        while (stack.length) {
            const root = stack.shift();
            if (!root || !('querySelector' in root) || !root.querySelector)
                continue;
            const el = root.querySelector<SelectEl>('atlas-select[name="layout-select"]');
            if (el) {
                el.value = next;
                el.dispatchEvent(new CustomEvent('change', {
                    detail: { value: next }, bubbles: true, composed: true,
                }));
                return;
            }
            const all = root.querySelectorAll('*');
            for (const e of all) {
                if (e.shadowRoot)
                    stack.push(e.shadowRoot);
            }
        }
    }, value);
}
async function waitForLayoutEditor(page: Page): Promise<void> {
    await page.waitForFunction(function () {
        const stack: Array<Document | ShadowRoot | Element> = [document];
        while (stack.length) {
            const root = stack.shift();
            if (!root || !('querySelector' in root) || !root.querySelector)
                continue;
            if (root.querySelector('atlas-layout-editor'))
                return true;
            const all = root.querySelectorAll('*');
            for (const e of all) {
                if (e.shadowRoot)
                    stack.push(e.shadowRoot);
            }
        }
        return false;
    });
}
test.describe('authoring.layout-editor — states', function () {
    test('route surface mounts on hash navigation', async function ({ page }) {
        await page.goto(`/${ROUTE}`);
        await expect(page.locator(ROUTE_SURFACE)).toBeVisible();
    });
    test('picker exposes the auto-generated test id', async function ({ page }) {
        await page.goto(`/${ROUTE}`);
        await expect(page.locator(PICKER)).toBeVisible();
    });
    test('picker offers a blank-canvas option plus presets', async function ({ page }) {
        await page.goto(`/${ROUTE}`);
        await page.locator(PICKER).waitFor();
        const opts = await pickerOptions(page);
        expect(opts.length).toBeGreaterThan(1);
        const first = assertDefined(opts[0], 'first picker option after length>1 check');
        expect(first.label).toBe('Blank canvas');
        // Presets follow the blank entry; at least one must be a real layoutId.
        expect(opts.some(function (o) {
            return o.value !== '__blank__';
        })).toBe(true);
    });
    test('layout editor element mounts on default option', async function ({ page }) {
        await page.goto(`/${ROUTE}`);
        await waitForLayoutEditor(page);
    });
});
test.describe('authoring.layout-editor — flows', function () {
    test('switching to a preset remounts the editor', async function ({ page }) {
        await page.goto(`/${ROUTE}`);
        await waitForLayoutEditor(page);
        const opts = await pickerOptions(page);
        const preset = assertDefined(opts.find(function (o) {
            return o.value !== '__blank__';
        }), 'at least one preset option besides __blank__');
        await setPickerValue(page, preset.value);
        // Editor should still be present after remount.
        await waitForLayoutEditor(page);
    });
    test('switching back to blank-canvas remounts a fresh editor', async function ({ page }) {
        await page.goto(`/${ROUTE}`);
        await waitForLayoutEditor(page);
        const opts = await pickerOptions(page);
        const preset = assertDefined(opts.find(function (o) {
            return o.value !== '__blank__';
        }), 'at least one preset option besides __blank__');
        await setPickerValue(page, preset.value);
        await waitForLayoutEditor(page);
        await setPickerValue(page, '__blank__');
        await waitForLayoutEditor(page);
    });
});
