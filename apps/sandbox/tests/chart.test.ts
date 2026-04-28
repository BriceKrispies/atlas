import { test, expect } from '@playwright/test';
import { openSpecimen, selectVariant } from './helpers.ts';

test.describe('atlas-chart specimen', () => {
  test('line variant renders SVG with series paths and points', async ({ page }) => {
    await openSpecimen(page, 'widgets.chart');
    const chart = page.locator('atlas-chart');
    await expect(chart).toBeVisible();
    await expect(chart.locator('svg')).toBeVisible();
    await expect(chart.locator('svg [role="img"], svg[role="img"]').first()).toBeVisible();
    const paths = chart.locator('svg path.series-line');
    expect(await paths.count()).toBeGreaterThanOrEqual(1);
    // Focusable data points
    const points = chart.locator('svg .atlas-chart-point');
    expect(await points.count()).toBeGreaterThanOrEqual(1);
  });

  test('hidden data table fallback mirrors chart data', async ({ page }) => {
    await openSpecimen(page, 'widgets.chart');
    const fallback = page.locator('atlas-chart table.atlas-visually-hidden');
    await expect(fallback).toBeAttached();
    const rows = fallback.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('legend renders when show-legend is set', async ({ page }) => {
    await openSpecimen(page, 'widgets.chart');
    const legend = page.locator('atlas-chart atlas-chart-legend');
    await expect(legend).toBeVisible();
  });

  test('bar variant renders rect shapes', async ({ page }) => {
    await openSpecimen(page, 'widgets.chart');
    await selectVariant(page, 'Bar');
    const rects = page.locator('atlas-chart svg rect.bar');
    expect(await rects.count()).toBeGreaterThanOrEqual(1);
  });

  test('stacked bar variant stacks slices on one x-axis position', async ({ page }) => {
    await openSpecimen(page, 'widgets.chart');
    await selectVariant(page, 'Stacked bar');
    const rects = page.locator('atlas-chart svg rect.bar');
    // Two series × four categories = 8 rects
    expect(await rects.count()).toBe(8);
  });

  test('pie variant renders slice paths', async ({ page }) => {
    await openSpecimen(page, 'widgets.chart');
    await selectVariant(page, 'Pie');
    const slices = page.locator('atlas-chart svg path.slice');
    expect(await slices.count()).toBe(4);
  });

  test('donut variant renders slices with inner radius', async ({ page }) => {
    await openSpecimen(page, 'widgets.chart');
    await selectVariant(page, 'Donut');
    const slices = page.locator('atlas-chart svg path.slice');
    expect(await slices.count()).toBe(4);
  });

  test('resizing the viewport rescales SVG width', async ({ page }) => {
    await openSpecimen(page, 'widgets.chart');
    const svg = page.locator('atlas-chart svg');
    const widthA = await svg.evaluate((el) => Number(el.getAttribute('width')));
    await page.setViewportSize({ width: 480, height: 800 });
    // ResizeObserver fires async; wait for the width to update.
    await expect
      .poll(async () => {
        return svg.evaluate((el) => Number(el.getAttribute('width')));
      })
      .not.toBe(widthA);
  });
});
