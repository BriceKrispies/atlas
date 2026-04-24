import { test, expect } from '@playwright/test';
import {
  readChartState,
  assertCommitted,
} from '@atlas/test-fixtures';
import { openSpecimen } from './helpers.js';

const ID = 'sales';

async function openCard(page) {
  await openSpecimen(page, 'widgets.chart-card');
  await page.locator('atlas-chart-card').waitFor();
  // Wait for first snapshot to exist so later reads have a store to query.
  await expect.poll(async () => (await readChartState(page, ID))?.chartId).toBe(ID);
}

test.describe('atlas-chart-card committed-state contract', () => {
  test('config change commits setConfig', async ({ page }) => {
    await openCard(page);
    await page.selectOption('atlas-chart-config-field[field="type"] select', 'line');
    const commit = await assertCommitted(page, `chart:${ID}`, {
      intent: 'setConfig',
      patch: { field: 'type', value: 'line' },
    });
    expect(commit.patch.value).toBe('line');
    const state = await readChartState(page, ID);
    expect(state.config.type).toBe('line');
  });

  test('time range preset commits setTimeRange', async ({ page }) => {
    await openCard(page);
    await page.locator('atlas-chart-time-range atlas-button[key="7d"]').click();
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'setTimeRange',
      patch: { preset: '7d' },
    });
    const state = await readChartState(page, ID);
    expect(state.timeRange).toMatchObject({ preset: '7d' });
  });

  test('filter set + clear commits setFilter / clearFilter', async ({ page }) => {
    await openCard(page);
    await page.selectOption('atlas-chart-filter[field="region"] select', 'EU');
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'setFilter',
      patch: { field: 'region', op: '=', value: 'EU' },
    });
    expect((await readChartState(page, ID)).filters).toEqual([
      { field: 'region', op: '=', value: 'EU' },
    ]);

    await page.selectOption('atlas-chart-filter[field="region"] select', '');
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'clearFilter',
      patch: { field: 'region' },
    });
    expect((await readChartState(page, ID)).filters).toEqual([]);
  });

  test('legend click commits toggleSeries and hides the series', async ({ page }) => {
    await openCard(page);
    const before = await readChartState(page, ID);
    expect(before.hiddenSeries).toEqual([]);
    expect(before.data.series.map((s) => s.id)).toEqual(['desktop', 'mobile']);

    await page.locator('atlas-chart-legend atlas-button[key="desktop"]').click();
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'toggleSeries',
      patch: { seriesId: 'desktop', hidden: true },
    });

    const after = await readChartState(page, ID);
    expect(after.hiddenSeries).toEqual(['desktop']);
    expect(after.data.series.map((s) => s.id)).toEqual(['mobile']);
  });

  test('export button commits requestExport with its format', async ({ page }) => {
    await openCard(page);
    await page.locator('atlas-chart-export-button[format="csv"] atlas-button').click();
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'requestExport',
      patch: { format: 'csv' },
    });
    expect((await readChartState(page, ID)).exportStatus.format).toBe('csv');

    await page.locator('atlas-chart-export-button[format="png"] atlas-button').click();
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'requestExport',
      patch: { format: 'png' },
    });
  });

  test('clicking a bar commits pushDrilldown; breadcrumb pops it', async ({ page }) => {
    await openCard(page);

    // Switch to bar (already default) and click a desktop bar.
    const bar = page.locator('atlas-chart svg rect.bar[data-series="0"]').first();
    await bar.waitFor();
    await bar.click();
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'pushDrilldown',
      patch: { value: 'desktop' },
    });
    const drilled = await readChartState(page, ID);
    expect(drilled.drilldownStack).toHaveLength(1);
    expect(drilled.data.series.map((s) => s.id)).toEqual([
      'desktop-chrome', 'desktop-safari', 'desktop-firefox',
    ]);

    // Breadcrumb "Top" pops back to depth 0.
    await page.locator('atlas-chart-drilldown atlas-button[key="0"]').click();
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'popDrilldown',
      patch: { toDepth: 0 },
    });
    const popped = await readChartState(page, ID);
    expect(popped.drilldownStack).toEqual([]);
  });

  test('testids on interactive children follow {surfaceId}.{name}.{key}', async ({ page }) => {
    await openCard(page);
    // Every legend button should have a data-testid ending in .series.<id>
    const testids = await page.locator('atlas-chart-legend atlas-button').evaluateAll(
      (els) => els.map((el) => el.getAttribute('data-testid')),
    );
    expect(testids.every((id) => id && /\.series\.(desktop|mobile)$/.test(id))).toBe(true);
  });
});
