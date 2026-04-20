import { test, expect } from '../fixtures.js';

const SURFACE = '[data-testid="admin.content.pages-list"]';

test.describe('content pages — full stack', () => {
  test('create page flow: browser → ingress → DB → browser', async ({
    page,
    api,
    ingressLogs,
  }) => {
    // Navigate to admin, wait for the surface to settle
    await page.goto('/');
    const surface = page.locator(SURFACE);
    await expect(surface).toHaveAttribute('data-state', /(success|empty)/);

    // Mark logs before the action
    ingressLogs.mark();

    // Handle the prompt dialog
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Integration Test Page');
      }
    });

    // Click create
    await page.getByRole('button', { name: 'Create page' }).click();

    // Wait for the page to appear (surface reloads after mutation)
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(surface).toHaveAttribute('data-state', 'success');
    await expect(page.getByText('Integration Test Page')).toBeVisible();

    // Assert backend logged the intent
    ingressLogs.assertLogged(
      (entry) =>
        entry.fields?.event_type?.includes('PageCreate') ||
        entry.fields?.action_id === 'ContentPages.Page.Create' ||
        JSON.stringify(entry).includes('ContentPages.Page.Create'),
      'Expected ingress to log the ContentPages.Page.Create intent'
    );
  });

  test('delete page flow: browser → ingress → DB → browser', async ({
    page,
    api,
    ingressLogs,
  }) => {
    // Seed a page via the real API
    const seeded = await api.seedPage('Page To Delete', 'page-to-delete');

    // Navigate and wait for the seeded page to appear
    await page.goto('/');
    const surface = page.locator(SURFACE);
    await expect(surface).toHaveAttribute('data-state', 'success');
    await expect(page.getByText('Page To Delete')).toBeVisible();

    // Mark logs before delete
    ingressLogs.mark();

    // Handle the confirm dialog
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'confirm') {
        await dialog.accept();
      }
    });

    // Click delete on the seeded page's row
    const row = page.getByText('Page To Delete').locator('..').locator('..');
    await row.getByRole('button', { name: 'Delete' }).click();

    // Wait for the table to update
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(surface).toHaveAttribute('data-state', /(success|empty)/);

    // Assert backend logged the delete intent
    ingressLogs.assertLogged(
      (entry) =>
        JSON.stringify(entry).includes('ContentPages.Page.Delete'),
      'Expected ingress to log the ContentPages.Page.Delete intent'
    );
  });

  test('page list loads real data from the database', async ({
    page,
    api,
    ingressLogs,
  }) => {
    // Seed pages via the real API
    const suffix = Date.now().toString(36);
    await api.seedPage(`Test Alpha ${suffix}`, `test-alpha-${suffix}`);
    await api.seedPage(`Test Beta ${suffix}`, `test-beta-${suffix}`);

    // Mark logs before navigation
    ingressLogs.mark();

    // Navigate and wait for data
    await page.goto('/');
    const surface = page.locator(SURFACE);
    await expect(surface).toHaveAttribute('data-state', 'success');

    // Assert both pages are visible
    await expect(page.getByText(`Test Alpha ${suffix}`)).toBeVisible();
    await expect(page.getByText(`Test Beta ${suffix}`)).toBeVisible();

    // Assert backend logged the GET request
    ingressLogs.assertLogged(
      (entry) =>
        JSON.stringify(entry).includes('/api/v1/pages') ||
        entry.fields?.route === '/api/v1/pages',
      'Expected ingress to log the GET /api/v1/pages request'
    );
  });
});
