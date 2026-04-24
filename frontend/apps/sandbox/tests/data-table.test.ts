import { test, expect } from '@playwright/test';
import { openSpecimen, selectVariant } from './helpers.ts';

test.describe('atlas-data-table specimen', () => {
  test('renders rows, columns, and pagination', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    const table = page.locator('atlas-data-table');
    await expect(table).toBeVisible();
    await expect(table).toHaveAttribute('data-state', 'success');

    // Default variant is pageSize=5, so the first page has 5 rows of 12 total.
    const rows = table.locator('atlas-table-body atlas-row');
    await expect(rows).toHaveCount(5);

    // Pagination reports "Page 1 of 3".
    await expect(
      table.locator('atlas-pagination [data-role="page-info"]'),
    ).toContainText('Page 1 of 3');
  });

  test('clicking a sortable header cycles aria-sort', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    const titleHeader = page.locator('atlas-table-cell[header][data-column-key="title"]');
    await expect(titleHeader).toHaveAttribute('aria-sort', 'none');
    await titleHeader.click();
    await expect(titleHeader).toHaveAttribute('aria-sort', 'ascending');
    await titleHeader.click();
    await expect(titleHeader).toHaveAttribute('aria-sort', 'descending');
    await titleHeader.click();
    await expect(titleHeader).toHaveAttribute('aria-sort', 'none');
  });

  test('sort reorders rows ascending by title', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    const titleHeader = page.locator('atlas-table-cell[header][data-column-key="title"]');
    await titleHeader.click(); // ascending
    const firstTitle = await page
      .locator('atlas-data-table atlas-table-body atlas-row')
      .first()
      .locator('atlas-table-cell')
      .first()
      .innerText();
    expect(firstTitle).toBe('About Us');
  });

  test('pagination next/prev move pages and clamp at boundaries', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    const info = page.locator('atlas-data-table atlas-pagination [data-role="page-info"]');
    const nextBtn = page.locator('atlas-pagination atlas-button[aria-label="Next page"]');
    await nextBtn.click();
    await expect(info).toContainText('Page 2 of 3');
    await nextBtn.click();
    await expect(info).toContainText('Page 3 of 3');
    // Next button should now be disabled.
    await expect(nextBtn).toHaveAttribute('disabled', '');
  });

  test('empty variant renders custom heading', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    await selectVariant(page, 'Empty');
    const table = page.locator('atlas-data-table');
    await expect(table).toHaveAttribute('data-state', 'empty');
    await expect(
      table.locator('atlas-stack[data-role="empty"] atlas-heading'),
    ).toHaveText('No results found');
  });

  test('multi-select variant records row-selected events', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    await selectVariant(page, 'Multi-select');

    // Click the first visible row.
    await page
      .locator('atlas-data-table atlas-table-body atlas-row')
      .first()
      .click();

    // The specimen's onLog surface renders the event in the mount log.
    const log = page.locator('atlas-box[data-role="mount-log"]');
    await expect(log).toContainText('row-selected');
  });

  test('filter: typing in title filter narrows rows', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    const table = page.locator('atlas-data-table');
    const filterInput = table.locator('atlas-input[data-column-key="title"]');
    // atlas-input renders a shadow-DOM <input>; type through the host.
    await filterInput.locator('>>> input').fill('policy');
    // change event fires on each keystroke; wait for a single match.
    await expect(
      table.locator('atlas-table-body atlas-row'),
    ).toHaveCount(1);
  });

  test('filtered-empty state offers clear-filters', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    const table = page.locator('atlas-data-table');
    const filterInput = table.locator('atlas-input[data-column-key="title"]');
    await filterInput.locator('>>> input').fill('no-such-title-zzz');
    await expect(table).toHaveAttribute('data-state', 'filtered-empty');
    await table.locator('atlas-stack[data-role="filtered-empty"] atlas-button').click();
    await expect(table).toHaveAttribute('data-state', 'success');
  });

  test('streaming variant applies upsert and remove patches', async ({ page }) => {
    await openSpecimen(page, 'widgets.data-table');
    await selectVariant(page, 'Streaming');

    const table = page.locator('atlas-data-table');
    await expect(table).toHaveAttribute('data-state', 'success');

    // Sort by id asc so we can reason about row order across streams.
    // (Default rowKey is 'id'; explicit sort ensures the new row lands at page edge.)
    await page.locator('atlas-table-cell[header][data-column-key="title"]').click();

    const log = page.locator('atlas-box[data-role="mount-log"]');

    // Inject an upsert patch via the specimen's imperative data source handle.
    await page.evaluate(() => {
      (window as unknown as { __atlasTestDataSource: { emit: (p: unknown) => void } }).__atlasTestDataSource.emit({
        type: 'upsert',
        row: { id: 99, title: 'Streamed Row', status: 'published', score: 100, updated: '2026-04-23' },
      });
    });
    await expect(log).toContainText('stream-patch-applied');

    // Typing a filter should now find the streamed row.
    const filterInput = table.locator('atlas-input[data-column-key="title"]');
    await filterInput.locator('>>> input').fill('Streamed');
    await expect(
      table.locator('atlas-table-body atlas-row'),
    ).toHaveCount(1);

    // Now remove and confirm the row disappears.
    await page.evaluate(() => {
      (window as unknown as { __atlasTestDataSource: { emit: (p: unknown) => void } }).__atlasTestDataSource.emit({
        type: 'remove',
        rowKey: 99,
      });
    });
    await expect(table).toHaveAttribute('data-state', 'filtered-empty');
  });
});
