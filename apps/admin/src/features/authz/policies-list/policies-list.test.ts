import { test, expect } from '@atlas/test-fixtures';

const SURFACE = '[data-testid="admin.authz.policies-list"]';

async function mockPolicies(page: import('@playwright/test').Page, body: unknown): Promise<void> {
  await page.route('**/api/v1/policies', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('admin.authz.policies-list surface', () => {
  test('navigates to empty state when tenant has no policies', async ({ page }) => {
    await mockPolicies(page, []);
    await page.goto('/#/authz/policies');
    const surface = page.locator(SURFACE);
    await expect(surface).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Authorization policies' })).toBeVisible();
    await expect(page.getByText('No policy versions yet')).toBeVisible();
  });

  test('renders rows when policies exist', async ({ page }) => {
    await mockPolicies(page, [
      {
        tenantId: 'tenant-001',
        version: 2,
        status: 'active',
        description: 'tenant-admin allow-list',
        lastModifiedAt: new Date().toISOString(),
        lastModifiedBy: 'user-001',
      },
      {
        tenantId: 'tenant-001',
        version: 1,
        status: 'archived',
        description: 'initial draft',
        lastModifiedAt: new Date().toISOString(),
        lastModifiedBy: 'user-001',
      },
    ]);
    await page.goto('/#/authz/policies');
    await expect(page.getByText('v2')).toBeVisible();
    await expect(page.getByText('v1')).toBeVisible();
  });
});
