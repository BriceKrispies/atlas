/**
 * authoring.page-gallery — Playwright smoke coverage.
 *
 * Verifies the gallery route mounts, the picker exposes its auto-generated
 * test id, and switching between gallery seed pages remounts the
 * `<content-page>` viewer.
 */

import { test, expect } from '@atlas/test-fixtures';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { Page } from '@playwright/test';

const ROUTE = '#/page-gallery';
const ROUTE_SURFACE = '[data-testid="authoring.page-gallery"]';
const PICKER = `${ROUTE_SURFACE} >> [data-testid="authoring.page-gallery.page-select"]`;

async function pickerOptions(page: Page): Promise<Array<{ value: string; label: string }>> {
  return page.evaluate(() => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift();
      if (!root || !('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('atlas-select[name="page-select"]') as
        (HTMLElement & { options?: Array<{ value: string; label: string }> }) | null;
      if (el && Array.isArray(el.options)) return el.options;
      const all = root.querySelectorAll('*');
      for (const e of all) {
        // `Element` already has the optional `shadowRoot` property —
        // open shadow roots populate it. Read directly rather than
        // re-narrowing.
        if (e.shadowRoot) stack.push(e.shadowRoot);
      }
    }
    return [];
  });
}

async function setPickerValue(page: Page, value: string): Promise<void> {
  await page.evaluate((next: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift();
      if (!root || !('querySelector' in root) || !root.querySelector) continue;
      const el = root.querySelector('atlas-select[name="page-select"]') as
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
        if (e.shadowRoot) stack.push(e.shadowRoot);
      }
    }
  }, value);
}

async function waitForPage(page: Page, pageId: string): Promise<void> {
  await page.waitForFunction((pid: string) => {
    const stack: Array<Document | ShadowRoot | Element> = [document];
    while (stack.length) {
      const root = stack.shift();
      if (!root || !('querySelector' in root) || !root.querySelector) continue;
      if (root.querySelector(`content-page[data-page-id="${pid}"]`)) return true;
      const all = root.querySelectorAll('*');
      for (const e of all) {
        if (e.shadowRoot) stack.push(e.shadowRoot);
      }
    }
    return false;
  }, pageId);
}

test.describe('authoring.page-gallery — states', () => {
  test('route surface mounts on hash navigation', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await expect(page.locator(ROUTE_SURFACE)).toBeVisible();
  });

  test('picker exposes the auto-generated test id', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await expect(page.locator(PICKER)).toBeVisible();
  });

  test('picker offers multiple gallery seeds', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await page.locator(PICKER).waitFor();
    const opts = await pickerOptions(page);
    expect(opts.length).toBeGreaterThan(1);
  });

  test('content-page mounts on default seed', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await page.locator(PICKER).waitFor();
    const opts = await pickerOptions(page);
    expect(opts.length).toBeGreaterThan(0);
    await waitForPage(page, assertDefined(opts[0], 'first picker option after length>0 check').value);
  });
});

test.describe('authoring.page-gallery — flows', () => {
  test('switching seeds remounts the content page', async ({ page }) => {
    await page.goto(`/${ROUTE}`);
    await page.locator(PICKER).waitFor();
    const opts = await pickerOptions(page);
    expect(opts.length).toBeGreaterThan(1);
    const first = assertDefined(opts[0], 'first picker option after length>1 check');
    const second = assertDefined(opts[1], 'second picker option after length>1 check');
    await waitForPage(page, first.value);

    await setPickerValue(page, second.value);
    await waitForPage(page, second.value);
  });
});
