import { test, expect, mockApi, assertA11y, samplePages } from '@atlas/test-fixtures';

const SURFACE = '[data-testid="admin.content.pages-list"]';

interface IntentEnvelope {
  tenantId?: string;
  idempotencyKey?: string;
  payload: {
    actionId: string;
    title?: string;
    slug?: string;
    [key: string]: unknown;
  };
}

test.describe('pages-list surface', () => {
  // -- States --

  test.describe('states', () => {
    test('shows loading skeleton before data arrives', async ({ page }) => {
      await mockApi(page, { pages: 'delay-2000' });
      await page.goto('/');
      const surface = page.locator(SURFACE);
      await expect(surface).toHaveAttribute('data-state', 'loading');
    });

    test('shows empty state when no pages exist', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');
      const surface = page.locator(SURFACE);
      await expect(surface).toHaveAttribute('data-state', 'empty');
      await expect(page.getByRole('heading', { name: 'No pages yet' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create page' })).toBeVisible();
    });

    test('shows table of pages on success', async ({ page }) => {
      await mockApi(page, { pages: samplePages });
      await page.goto('/');
      const surface = page.locator(SURFACE);
      await expect(surface).toHaveAttribute('data-state', 'success');
      await expect(page.getByText('Welcome Page')).toBeVisible();
      await expect(page.getByText('Getting Started Guide')).toBeVisible();
      await expect(page.getByText('FAQ', { exact: true })).toBeVisible();
    });

    test('shows error with retry on API failure', async ({ page }) => {
      await mockApi(page, { pages: 'error-500' });
      await page.goto('/');
      const surface = page.locator(SURFACE);
      await expect(surface).toHaveAttribute('data-state', 'error');
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    });
  });

  // -- Flows --

  test.describe('flows', () => {
    test('retry reloads data after error', async ({ page }) => {
      let callCount = 0;
      await page.route('**/api/v1/pages', (route) => {
        callCount++;
        if (callCount === 1) {
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'internal_error' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(samplePages),
        });
      });

      await page.goto('/');
      const surface = page.locator(SURFACE);
      await expect(surface).toHaveAttribute('data-state', 'error');

      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(surface).toHaveAttribute('data-state', 'success');
      await expect(page.getByText('Welcome Page')).toBeVisible();
    });

    test('create page submits intent and reloads', async ({ page }) => {
      const requests: IntentEnvelope[] = [];
      await mockApi(page, { pages: samplePages });
      await page.route('**/api/v1/intents', (route) => {
        const postData = route.request().postData() ?? '{}';
        requests.push(JSON.parse(postData) as IntentEnvelope);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      });

      await page.goto('/');
      await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');

      // Handle the prompt() dialog for title input
      page.on('dialog', async (dialog) => {
        if (dialog.type() === 'prompt') {
          await dialog.accept('My New Page');
        }
      });

      await page.getByRole('button', { name: 'Create page' }).click();

      // Verify the intent envelope was submitted with correct payload
      expect(requests.length).toBeGreaterThanOrEqual(1);
      const envelope = requests[0]!;
      expect(envelope.payload.actionId).toBe('ContentPages.Page.Create');
      expect(envelope.payload.title).toBe('My New Page');
      expect(envelope.payload.slug).toBe('my-new-page');
      expect(envelope.tenantId).toBeTruthy();
      expect(envelope.idempotencyKey).toBeTruthy();
    });

    test('delete page submits intent after confirmation', async ({ page }) => {
      const requests: IntentEnvelope[] = [];
      await mockApi(page, { pages: samplePages });
      await page.route('**/api/v1/intents', (route) => {
        const postData = route.request().postData() ?? '{}';
        requests.push(JSON.parse(postData) as IntentEnvelope);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      });

      await page.goto('/');
      await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');

      // Handle the confirm() dialog
      page.on('dialog', async (dialog) => {
        if (dialog.type() === 'confirm') {
          await dialog.accept();
        }
      });

      // Click the first delete button
      const deleteButtons = page.getByRole('button', { name: 'Delete' });
      await deleteButtons.first().click();

      expect(requests.length).toBeGreaterThanOrEqual(1);
      expect(requests[0]!.payload.actionId).toBe('ContentPages.Page.Delete');
    });
  });

  // -- Telemetry --

  test.describe('telemetry', () => {
    test('emits page-viewed on mount', async ({ page, telemetrySpy }) => {
      await mockApi(page, { pages: samplePages });
      await page.goto('/');
      await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');

      // Small wait for async telemetry event collection
      await page.waitForTimeout(100);

      expect(telemetrySpy).toHaveEmitted({
        eventName: 'admin.content.pages-list.page-viewed',
        surfaceId: 'admin.content.pages-list',
      });
    });

    test('emits create-clicked when create button pressed', async ({ page, telemetrySpy }) => {
      await mockApi(page, { pages: samplePages });
      await page.goto('/');
      await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');

      // Dismiss the prompt immediately
      page.on('dialog', (dialog) => {
        void dialog.dismiss();
      });

      await page.getByRole('button', { name: 'Create page' }).click();
      await page.waitForTimeout(100);

      expect(telemetrySpy).toHaveEmitted({
        eventName: 'admin.content.pages-list.create-clicked',
      });
    });
  });

  // -- Accessibility --

  test.describe('accessibility', () => {
    test('passes axe scan in success state', async ({ page }) => {
      await mockApi(page, { pages: samplePages });
      await page.goto('/');
      await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');
      await assertA11y(page, { include: SURFACE });
    });

    test('passes axe scan in empty state', async ({ page }) => {
      await mockApi(page, { pages: [] });
      await page.goto('/');
      await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'empty');
      await assertA11y(page, { include: SURFACE });
    });
  });
});
