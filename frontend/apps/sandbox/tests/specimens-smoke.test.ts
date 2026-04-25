import { test, expect } from '@playwright/test';
import { openSpecimen } from './helpers.ts';

test.describe('sandbox — specimens smoke', () => {
  test('home loads with sidebar populated', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('atlas-nav-item.item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(3);
  });

  test('can open the announcements widget specimen', async ({ page }) => {
    await openSpecimen(page, 'widget.content.announcements');
    const surface = page.locator('[data-testid="widget.content.announcements"]').first();
    await expect(surface).toBeVisible();
  });

  test('can open the welcome content page and render its template', async ({ page }) => {
    await openSpecimen(page, 'page.welcome');
    const cp = page.locator('content-page[data-page-id="welcome"]');
    await expect(cp).toBeVisible();
    // Welcome seeds main with one widget; the sidebar slot is empty by
    // default so the two-column template shows exactly one widget cell.
    await expect(page.locator('section[data-slot="main"] [data-widget-cell]').first()).toBeVisible();
    await expect(
      page.locator('section[data-slot="sidebar"] [data-widget-cell]'),
    ).toHaveCount(0);
  });

  // Batch 1: form-control primitives. Each specimen must open and render
  // at least one of its tag in the preview body.
  const formControls: Array<{ id: string; tag: string }> = [
    { id: 'checkbox',     tag: 'atlas-checkbox' },
    { id: 'radio-group',  tag: 'atlas-radio-group' },
    { id: 'switch',       tag: 'atlas-switch' },
    { id: 'textarea',     tag: 'atlas-textarea' },
    { id: 'number-input', tag: 'atlas-number-input' },
    { id: 'search-input', tag: 'atlas-search-input' },
    { id: 'select',       tag: 'atlas-select' },
    { id: 'slider',       tag: 'atlas-slider' },
    { id: 'date-picker',  tag: 'atlas-date-picker' },
    { id: 'file-upload',  tag: 'atlas-file-upload' },
    { id: 'form-field',   tag: 'atlas-form-field' },
  ];

  for (const { id, tag } of formControls) {
    test(`Forms specimen "${id}" renders ${tag}`, async ({ page }) => {
      await openSpecimen(page, id);
      await expect(page.locator(tag).first()).toBeVisible();
    });
  }

  // Batch Data & Composites — specimens smoke
  const dataAndComposites: Array<{ id: string; tag: string }> = [
    { id: 'timeline',     tag: 'atlas-timeline' },
    { id: 'stat',         tag: 'atlas-stat' },
    { id: 'split-button', tag: 'atlas-split-button' },
    { id: 'toggle-group', tag: 'atlas-toggle-group' },
  ];

  for (const { id, tag } of dataAndComposites) {
    test(`Batch Data & Composites — specimen "${id}" renders ${tag}`, async ({ page }) => {
      await openSpecimen(page, id);
      await expect(page.locator(tag).first()).toBeVisible();
    });
  }
});
