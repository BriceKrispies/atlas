import { test, expect, mockApi, samplePages } from '@atlas/test-fixtures';

const MODULES: readonly string[] = [
  'Content',
  'Badges',
  'Points',
  'Org',
  'Comms',
  'Tokens',
  'Import',
  'Audit',
];

test.describe('admin-shell navigation', () => {
  // -- States --

  test.describe('states', () => {
    test('default route loads the content module', async ({ page }) => {
      await mockApi(page, { pages: samplePages });
      await page.goto('/');
      await expect(page.getByText('Welcome Page')).toBeVisible();
    });

    test('each module route shows its heading', async ({ page }) => {
      await mockApi(page, { pages: [] });

      for (const mod of ['badges', 'points', 'org', 'comms', 'tokens', 'import', 'audit']) {
        await page.goto(`/#/${mod}`);
        const label = mod.charAt(0).toUpperCase() + mod.slice(1);
        await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
      }
    });

    test('content route shows the pages list surface', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/#/content');
      const surface = page.locator('[data-testid="admin.content.pages-list"]');
      await expect(surface).toBeVisible();
    });
  });

  // -- Flows --

  test.describe('flows', () => {
    test('clicking a nav item changes the hash and swaps content', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');

      await page.getByRole('link', { name: 'Badges' }).click();
      expect(page.url()).toContain('#/badges');
      await expect(page.getByRole('heading', { name: 'Badges', exact: true })).toBeVisible();
    });

    test('clicking between nav items swaps the visible module', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');

      await page.getByRole('link', { name: 'Points' }).click();
      await expect(page.getByRole('heading', { name: 'Points', exact: true })).toBeVisible();

      await page.getByRole('link', { name: 'Org' }).click();
      await expect(page.getByRole('heading', { name: 'Org', exact: true })).toBeVisible();
      // Previous module content should no longer be visible
      await expect(page.getByRole('heading', { name: 'Points', exact: true })).not.toBeVisible();
    });

    test('browser back/forward works with hash routing', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');

      await page.getByRole('link', { name: 'Badges' }).click();
      await expect(page.getByRole('heading', { name: 'Badges', exact: true })).toBeVisible();

      await page.getByRole('link', { name: 'Audit' }).click();
      await expect(page.getByRole('heading', { name: 'Audit', exact: true })).toBeVisible();

      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Badges', exact: true })).toBeVisible();

      await page.goForward();
      await expect(page.getByRole('heading', { name: 'Audit', exact: true })).toBeVisible();
    });

    test('direct hash URL navigation shows the correct module', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/#/tokens');
      await expect(page.getByRole('heading', { name: 'Tokens', exact: true })).toBeVisible();
    });
  });

  // -- Navigation active state --

  test.describe('navigation', () => {
    test('Content nav item is active on default route', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');
      const contentLink = page.getByRole('link', { name: 'Content' });
      await expect(contentLink).toHaveAttribute('active', '');
      await expect(contentLink).toHaveAttribute('aria-current', 'page');
    });

    test('active state follows the current route', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/#/badges');

      const badgesLink = page.getByRole('link', { name: 'Badges' });
      await expect(badgesLink).toHaveAttribute('active', '');
      await expect(badgesLink).toHaveAttribute('aria-current', 'page');

      // Content should not be active
      const contentLink = page.getByRole('link', { name: 'Content' });
      await expect(contentLink).not.toHaveAttribute('active', '');
    });

    test('only one nav item is active at a time', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/#/org');

      // Verify Org is active and all others are not
      await expect(page.getByRole('link', { name: 'Org' })).toHaveAttribute('aria-current', 'page');
      for (const label of MODULES.filter((m) => m !== 'Org')) {
        await expect(page.getByRole('link', { name: label })).not.toHaveAttribute('aria-current', 'page');
      }

      // Navigate and verify only Comms is active
      await page.getByRole('link', { name: 'Comms' }).click();
      await expect(page.getByRole('link', { name: 'Comms' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('link', { name: 'Org' })).not.toHaveAttribute('aria-current', 'page');
    });

    test('all module nav items are rendered', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');

      for (const label of MODULES) {
        await expect(page.getByRole('link', { name: label })).toBeVisible();
      }
    });
  });

  // -- Accessibility --

  test.describe('accessibility', () => {
    test('nav region has an accessible label', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');

      const nav = page.getByRole('navigation', { name: 'Admin navigation' });
      await expect(nav).toBeVisible();
    });

    test('nav items have link role', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');

      for (const label of MODULES) {
        const item = page.getByRole('link', { name: label });
        await expect(item).toBeVisible();
      }
    });

    test('active nav item has aria-current="page"', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/#/badges');

      const badgesLink = page.getByRole('link', { name: 'Badges' });
      await expect(badgesLink).toHaveAttribute('aria-current', 'page');
    });

    test('nav items are keyboard-accessible with tabindex', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');

      for (const label of MODULES) {
        const item = page.getByRole('link', { name: label });
        await expect(item).toHaveAttribute('tabindex', '0');
      }
    });
  });
});
