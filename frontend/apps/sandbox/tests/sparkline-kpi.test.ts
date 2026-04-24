import { test, expect } from '@playwright/test';
import { openSpecimen } from './helpers.ts';

test.describe('atlas-sparkline specimen', () => {
  test('renders an SVG path with numeric coordinates', async ({ page }) => {
    await openSpecimen(page, 'widgets.sparkline');
    const sparkline = page.locator('atlas-sparkline').first();
    const path = sparkline.locator('svg path');
    await expect(path).toHaveCount(1);
    const d = await path.getAttribute('d');
    expect(d).toMatch(/^M\s+\d/);
  });

  test('show-last-point variant draws a circle', async ({ page }) => {
    await openSpecimen(page, 'widgets.sparkline');
    // Second variant in the registered order
    await page.locator('[data-testid="sandbox.variant-switcher.with-last-point-marker"]').click();
    const sparkline = page.locator('atlas-sparkline').first();
    await expect(sparkline.locator('svg circle')).toHaveCount(1);
  });
});

test.describe('atlas-kpi-tile specimen', () => {
  test('renders label, value, and trend elements', async ({ page }) => {
    await openSpecimen(page, 'widgets.kpi-tile');
    const tile = page.locator('atlas-kpi-tile').first();
    await expect(tile.locator('[data-role="label"]')).toHaveText('Daily active users');
    await expect(tile.locator('[data-role="value"]')).toContainText('12,482');
    const trend = tile.locator('[data-role="trend"]');
    await expect(trend).toHaveAttribute('data-trend', 'up');
  });

  test('sparkline variant composes atlas-sparkline inside tile', async ({ page }) => {
    await openSpecimen(page, 'widgets.kpi-tile');
    await page.locator('[data-testid="sandbox.variant-switcher.with-sparkline"]').click();
    const tile = page.locator('atlas-kpi-tile').first();
    await expect(tile.locator('atlas-sparkline')).toBeVisible();
  });
});
