/**
 * authoring.shell — Playwright coverage.
 *
 * Outer shell of the authoring app. Verifies hash routing mounts the
 * correct route element, that all four routes are reachable, and that
 * the sidebar shows the right active selection.
 */

import { test, expect } from '@atlas/test-fixtures';

const SHELL = '[data-testid="authoring.shell"]';

const ROUTES = [
  { id: 'page-editor', surface: 'authoring.page-editor', label: 'Page Editor' },
  { id: 'layout-editor', surface: 'authoring.layout-editor', label: 'Layout Editor' },
  { id: 'block-editor', surface: 'authoring.block-editor', label: 'Block Editor' },
  { id: 'page-gallery', surface: 'authoring.page-gallery', label: 'Page Gallery' },
] as const;

test.describe('authoring.shell — states', () => {
  test('shell renders with auto-generated surface test id', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(SHELL)).toBeVisible();
  });

  test('default route mounts the page-editor route element', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="authoring.page-editor"]')).toBeVisible();
  });
});

test.describe('authoring.shell — navigation', () => {
  for (const route of ROUTES) {
    test(`#/${route.id} mounts ${route.surface}`, async ({ page }) => {
      await page.goto(`/#/${route.id}`);
      await expect(page.locator(`[data-testid="${route.surface}"]`)).toBeVisible();
    });
  }

  test('clicking a sidebar nav-item swaps the active route', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="authoring.page-editor"]')).toBeVisible();

    // Click the layout-editor nav item by its visible label.
    const layoutNav = page.locator('atlas-nav-item').getByText('Layout Editor', { exact: true });
    await layoutNav.click();

    await expect(page.locator('[data-testid="authoring.layout-editor"]')).toBeVisible();
    await expect(page.locator('[data-testid="authoring.page-editor"]')).toHaveCount(0);
  });

  test('hash navigation updates the selected nav item', async ({ page }) => {
    await page.goto(`/#/block-editor`);
    await expect(page.locator('[data-testid="authoring.block-editor"]')).toBeVisible();

    const selected = page.locator('atlas-nav-item[aria-selected="true"]');
    await expect(selected).toHaveAttribute('data-id', 'block-editor');
  });
});
