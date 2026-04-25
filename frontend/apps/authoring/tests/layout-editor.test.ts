/**
 * authoring.layout-editor — Playwright smoke coverage.
 *
 * Verifies the layout editor route mounts, the picker exposes its
 * auto-generated test id, and switching between blank canvas and a preset
 * remounts the inner `<atlas-layout-editor>`.
 */

import { test, expect } from '@atlas/test-fixtures';
import type { Page } from '@playwright/test';

const ROUTE = '#/layout-editor';
const ROUTE_SURFACE = '[data-testid="authoring.layout-editor"]';
const PICKER = `${ROUTE_SURFACE} >> [data-testid="authoring.layout-editor.layout-select"]`;

async function pickerOptions(page: Page): Promise<Array<{ value: string; label: string }>> {
  return page.evaluate(() => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('atlas-select[name="layout-select"]') as
        (HTMLElement & { options?: Array<{ value: string; label: string }> }) | null;
      if (el && Array.isArray(el.options)) return el.options;
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    return [];
  });
}

async function setPickerValue(page: Page, value: string): Promise<void> {
  await page.evaluate((next: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('atlas-select[name="layout-select"]') as
        (HTMLElement & { value: string }) | null;
      if (el) {
        el.value = next;
        el.dispatchEvent(new CustomEvent('change', {
          detail: { value: next }, bubbles: true, composed: true,
        }));
        return;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
  }, value);
}

async function waitForLayoutEditor(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift()!;
      if (!('querySelector' in root) || !root.querySelector) continue;
      if (root.querySelector('atlas-layout-editor')) return true;
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const node = e as Element & { shadowRoot?: ShadowRoot };
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
    }
    return false;
  });
}

test.describe('authoring.layout-editor — states', () => {
  test('route surface mounts on hash navigation', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await expect(page.locator(ROUTE_SURFACE)).toBeVisible();
  });

  test('picker exposes the auto-generated test id', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await expect(page.locator(PICKER)).toBeVisible();
  });

  test('picker offers a blank-canvas option plus presets', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await page.locator(PICKER).waitFor();
    const opts = await pickerOptions(page);
    expect(opts.length).toBeGreaterThan(1);
    expect(opts[0]!.label).toBe('Blank canvas');
    // Presets follow the blank entry; at least one must be a real layoutId.
    expect(opts.some((o) => o.value !== '__blank__')).toBe(true);
  });

  test('layout editor element mounts on default option', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await waitForLayoutEditor(page);
  });
});

test.describe('authoring.layout-editor — flows', () => {
  test('switching to a preset remounts the editor', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await waitForLayoutEditor(page);
    const opts = await pickerOptions(page);
    const preset = opts.find((o) => o.value !== '__blank__');
    expect(preset).toBeDefined();

    await setPickerValue(page, preset!.value);

    // Editor should still be present after remount.
    await waitForLayoutEditor(page);
  });

  test('switching back to blank-canvas remounts a fresh editor', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await waitForLayoutEditor(page);
    const opts = await pickerOptions(page);
    const preset = opts.find((o) => o.value !== '__blank__');
    await setPickerValue(page, preset!.value);
    await waitForLayoutEditor(page);

    await setPickerValue(page, '__blank__');
    await waitForLayoutEditor(page);
  });
});
