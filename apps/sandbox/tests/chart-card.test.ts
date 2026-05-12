import { test, expect } from '@playwright/test';
import {
  readChartState,
  assertCommitted,
} from '@atlas/test-fixtures';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { openSpecimen } from './helpers.ts';
import type { Page } from '@playwright/test';

const ID = 'sales';

// ── typed snapshot shapes ──────────────────────────────────────────
// The chart-card surface's reader is contract-pinned by its controller.
// Encode the shape once, narrow at the boundary, reuse everywhere.

interface ChartSeries {
  id: string;
}
interface ChartFilter {
  field: string;
  op: string;
  value: string;
}
interface ChartSnapshot {
  chartId: string;
  config: { type: string };
  timeRange: { preset: string };
  filters: ChartFilter[];
  hiddenSeries: string[];
  data: { series: ChartSeries[] };
  exportStatus: { format: string };
  drilldownStack: unknown[];
}

interface CommitPatch {
  patch: { value?: string; format?: string; preset?: string; field?: string; op?: string };
}

/**
 * Boundary: `readChartState` returns `unknown` by design (test-state
 * registry is shape-erased). The chart-card surface shape is contract-
 * pinned by its controller — one justified narrowing here keeps call
 * sites clean.
 */
async function readChart(page: Page, id: string): Promise<ChartSnapshot | null> {
  const snap = await readChartState(page, id);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: test-state registry returns unknown by design; the chart-card surface shape is contract-pinned by its controller.
  return snap as ChartSnapshot | null;
}

async function readChartOrThrow(page: Page, id: string): Promise<ChartSnapshot> {
  return assertDefined(await readChart(page, id), `chart snapshot for ${id}`);
}

/**
 * Boundary: `assertCommitted` returns `unknown` from the same erased
 * registry. The commit-log shape is fixed by the chart-card controller.
 */
async function assertCommit(
  page: Page,
  key: string,
  match: { intent: string; patch: Record<string, unknown> },
): Promise<CommitPatch> {
  const commit = await assertCommitted(page, key, match);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: assertCommitted returns unknown; commit shape is contract-pinned by the chart-card controller.
  return commit as CommitPatch;
}

async function openCard(page: Page): Promise<void> {
  await openSpecimen(page, 'widgets.chart-card');
  await page.locator('atlas-chart-card').waitFor();
  // Wait for first snapshot to exist so later reads have a store to query.
  await expect
    .poll(async () => (await readChart(page, ID))?.chartId)
    .toBe(ID);
}

test.describe('atlas-chart-card committed-state contract', () => {
  test('config change commits setConfig', async ({ page }) => {
    await openCard(page);
    await page.selectOption('atlas-chart-config-field[field="type"] select', 'line');
    const commit = await assertCommit(page, `chart:${ID}`, {
      intent: 'setConfig',
      patch: { field: 'type', value: 'line' },
    });
    expect(commit.patch.value).toBe('line');
    const state = await readChartOrThrow(page, ID);
    expect(state.config.type).toBe('line');
  });

  test('time range preset commits setTimeRange', async ({ page }) => {
    await openCard(page);
    await page.locator('atlas-chart-time-range atlas-button[key="7d"]').click();
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'setTimeRange',
      patch: { preset: '7d' },
    });
    const state = await readChartOrThrow(page, ID);
    expect(state.timeRange).toMatchObject({ preset: '7d' });
  });

  test('filter set + clear commits setFilter / clearFilter', async ({ page }) => {
    await openCard(page);
    await page.selectOption('atlas-chart-filter[field="region"] select', 'EU');
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'setFilter',
      patch: { field: 'region', op: '=', value: 'EU' },
    });
    expect((await readChartOrThrow(page, ID)).filters).toEqual([
      { field: 'region', op: '=', value: 'EU' },
    ]);

    await page.selectOption('atlas-chart-filter[field="region"] select', '');
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'clearFilter',
      patch: { field: 'region' },
    });
    expect((await readChartOrThrow(page, ID)).filters).toEqual([]);
  });

  test('legend click commits toggleSeries and hides the series', async ({ page }) => {
    await openCard(page);
    const before = await readChartOrThrow(page, ID);
    expect(before.hiddenSeries).toEqual([]);
    expect(before.data.series.map((s) => s.id)).toEqual(['desktop', 'mobile']);

    await page.locator('atlas-chart-legend atlas-button[key="desktop"]').click();
    await assertCommitted(page, `chart:${ID}`, {
      intent: 'toggleSeries',
      patch: { seriesId: 'desktop', hidden: true },
    });

    const after = await readChartOrThrow(page, ID);
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
    expect((await readChartOrThrow(page, ID)).exportStatus.format).toBe('csv');

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
    const drilled = await readChartOrThrow(page, ID);
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
    const popped = await readChartOrThrow(page, ID);
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
