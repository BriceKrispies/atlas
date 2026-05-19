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
function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/**
 * Type-guard for the captured intent envelope shape. `JSON.parse` is
 * typed `any` — route through `unknown` and validate the minimal shape
 * so downstream `requests[i]` reads are typed without `as` casts.
 */
function isIntentEnvelope(v: unknown): v is IntentEnvelope {
    if (!isRecord(v))
        return false;
    const payload = v['payload'];
    if (!isRecord(payload))
        return false;
    return typeof payload['actionId'] === 'string';
}
/**
 * Parse a captured POST body into a typed envelope, throwing if the
 * shape didn't match. Replaces the `JSON.parse(x) as IntentEnvelope`
 * unsafe cast at every callsite.
 */
function parseIntentEnvelope(raw: string): IntentEnvelope {
    const parsed: unknown = JSON.parse(raw);
    if (!isIntentEnvelope(parsed)) {
        throw new Error('captured request was not a valid intent envelope');
    }
    return parsed;
}
/**
 * Return `arr[i]` or throw — replaces the `arr[i]!` non-null assertion
 * pattern. Surfaces an actionable error if the test setup didn't capture
 * the expected request.
 */
function at<T>(arr: readonly T[], i: number, what: string): T {
    const v = arr[i];
    if (v === undefined) {
        throw new Error(`${what}: expected element at index ${String(i)}, got undefined`);
    }
    return v;
}
test.describe('pages-list surface', function () {
    // -- States --
    test.describe('states', function () {
        test('shows loading skeleton before data arrives', async function ({ page }) {
            await mockApi(page, { pages: 'delay-2000' });
            await page.goto('/');
            const surface = page.locator(SURFACE);
            await expect(surface).toHaveAttribute('data-state', 'loading');
        });
        test('shows empty state when no pages exist', async function ({ page }) {
            await mockApi(page, { pages: [] });
            await page.goto('/');
            const surface = page.locator(SURFACE);
            await expect(surface).toHaveAttribute('data-state', 'empty');
            await expect(page.getByRole('heading', { name: 'No pages yet' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Create page' })).toBeVisible();
        });
        test('shows table of pages on success', async function ({ page }) {
            await mockApi(page, { pages: samplePages });
            await page.goto('/');
            const surface = page.locator(SURFACE);
            await expect(surface).toHaveAttribute('data-state', 'success');
            await expect(page.getByText('Welcome Page')).toBeVisible();
            await expect(page.getByText('Getting Started Guide')).toBeVisible();
            await expect(page.getByText('FAQ', { exact: true })).toBeVisible();
        });
        test('shows error with retry on API failure', async function ({ page }) {
            await mockApi(page, { pages: 'error-500' });
            await page.goto('/');
            const surface = page.locator(SURFACE);
            await expect(surface).toHaveAttribute('data-state', 'error');
            await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
        });
    });
    // -- Flows --
    test.describe('flows', function () {
        test('retry reloads data after error', async function ({ page }) {
            let callCount = 0;
            await page.route('**/api/v1/pages', function (route) {
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
        test('create page submits intent and reloads', async function ({ page }) {
            const requests: IntentEnvelope[] = [];
            await mockApi(page, { pages: samplePages });
            await page.route('**/api/v1/intents', function (route) {
                const postData = route.request().postData() ?? '{}';
                requests.push(parseIntentEnvelope(postData));
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ ok: true }),
                });
            });
            await page.goto('/');
            await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');
            // Handle the prompt() dialog for title input
            page.on('dialog', async function (dialog) {
                if (dialog.type() === 'prompt') {
                    await dialog.accept('My New Page');
                }
            });
            await page.getByRole('button', { name: 'Create page' }).click();
            // Verify the intent envelope was submitted with correct payload
            expect(requests.length).toBeGreaterThanOrEqual(1);
            const envelope = at(requests, 0, 'create page intent');
            expect(envelope.payload.actionId).toBe('ContentPages.Page.Create');
            expect(envelope.payload.title).toBe('My New Page');
            expect(envelope.payload.slug).toBe('my-new-page');
            expect(envelope.tenantId).toBeTruthy();
            expect(envelope.idempotencyKey).toBeTruthy();
        });
        test('delete page submits intent after confirmation', async function ({ page }) {
            const requests: IntentEnvelope[] = [];
            await mockApi(page, { pages: samplePages });
            await page.route('**/api/v1/intents', function (route) {
                const postData = route.request().postData() ?? '{}';
                requests.push(parseIntentEnvelope(postData));
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ ok: true }),
                });
            });
            await page.goto('/');
            await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');
            // Handle the confirm() dialog
            page.on('dialog', async function (dialog) {
                if (dialog.type() === 'confirm') {
                    await dialog.accept();
                }
            });
            // Click the first delete button
            const deleteButtons = page.getByRole('button', { name: 'Delete' });
            await deleteButtons.first().click();
            expect(requests.length).toBeGreaterThanOrEqual(1);
            expect(at(requests, 0, 'delete page intent').payload.actionId).toBe('ContentPages.Page.Delete');
        });
    });
    // -- Telemetry --
    test.describe('telemetry', function () {
        test('emits page-viewed on mount', async function ({ page, telemetrySpy }) {
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
        test('emits create-clicked when create button pressed', async function ({ page, telemetrySpy }) {
            await mockApi(page, { pages: samplePages });
            await page.goto('/');
            await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');
            // Dismiss the prompt immediately
            page.on('dialog', function (dialog) {
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
    test.describe('accessibility', function () {
        test('passes axe scan in success state', async function ({ page }) {
            await mockApi(page, { pages: samplePages });
            await page.goto('/');
            await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'success');
            await assertA11y(page, { include: SURFACE });
        });
        test('passes axe scan in empty state', async function ({ page }) {
            await mockApi(page, { pages: [] });
            await page.goto('/');
            await expect(page.locator(SURFACE)).toHaveAttribute('data-state', 'empty');
            await assertA11y(page, { include: SURFACE });
        });
    });
});
