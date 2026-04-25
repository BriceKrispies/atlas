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

  // Batch Mobile overlays — specimens smoke. Sheets/dialogs are display:
  // contents at rest, so we trigger their open mechanism (or, for FAB,
  // assert the host element directly) before asserting visibility.
  const mobileOverlays: Array<{ id: string; tag: string }> = [
    { id: 'bottom-sheet', tag: 'atlas-bottom-sheet' },
    { id: 'action-sheet', tag: 'atlas-action-sheet' },
    { id: 'fab',          tag: 'atlas-fab' },
  ];

  for (const { id, tag } of mobileOverlays) {
    test(`Mobile overlays specimen "${id}" renders ${tag}`, async ({ page }) => {
      await openSpecimen(page, id);
      // FAB is a positioned button — visible immediately. Sheets render
      // via display:contents until opened, so for those we click the
      // first trigger and then assert the dialog inside is visible.
      if (tag === 'atlas-fab') {
        await expect(page.locator(tag).first()).toBeVisible();
      } else {
        // Each sheet specimen mounts an atlas-button trigger row; tapping
        // the first one opens the first sheet. The shadow-DOM dialog is
        // observable via the host's [open] reflected attribute.
        const triggers = page.locator('atlas-button');
        await triggers.first().click();
        await expect(page.locator(`${tag}[open]`).first()).toHaveAttribute('open', '');
      }
    });
  }

  // Batch Gestures — specimens smoke
  const gestureSpecimens: Array<{ id: string; tag: string }> = [
    { id: 'pull-to-refresh', tag: 'atlas-pull-to-refresh' },
    { id: 'swipe-actions',   tag: 'atlas-swipe-actions' },
  ];

  for (const { id, tag } of gestureSpecimens) {
    test(`Batch Gestures — specimen "${id}" renders ${tag}`, async ({ page }) => {
  // Batch Identity & Chips — specimens smoke
  const identityAndChips: Array<{ id: string; tag: string }> = [
    { id: 'avatar',       tag: 'atlas-avatar' },
    { id: 'avatar-group', tag: 'atlas-avatar-group' },
    { id: 'tag',          tag: 'atlas-tag' },
    { id: 'chip',         tag: 'atlas-chip' },
    { id: 'chip-group',   tag: 'atlas-chip-group' },
    { id: 'chip-input',   tag: 'atlas-chip-input' },
  ];

  for (const { id, tag } of identityAndChips) {
    test(`Batch Identity & Chips — specimen "${id}" renders ${tag}`, async ({ page }) => {
  // Batch Nav structure — specimens smoke
  const navStructure: Array<{ id: string; tag: string }> = [
    { id: 'breadcrumbs', tag: 'atlas-breadcrumbs' },
    { id: 'tree',        tag: 'atlas-tree' },
    { id: 'stepper',     tag: 'atlas-stepper' },
    { id: 'pagination',  tag: 'atlas-pagination' },
    { id: 'progress',    tag: 'atlas-progress' },
  ];

  for (const { id, tag } of navStructure) {
    test(`Nav structure specimen "${id}" renders ${tag}`, async ({ page }) => {
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

  // Batch Agent — specimens smoke. Each agent-oriented primitive renders
  // at least one of its tag in the preview body. The resource-picker
  // host element is present at mount time (it slots a trigger button +
  // a closed picker shell), so a tag-only assertion is sufficient.
  const agentPrimitives: Array<{ id: string; tag: string }> = [
    { id: 'diff',             tag: 'atlas-diff' },
    { id: 'json-view',        tag: 'atlas-json-view' },
    { id: 'activity',         tag: 'atlas-activity' },
    { id: 'consent-banner',   tag: 'atlas-consent-banner' },
    { id: 'capability-grid',  tag: 'atlas-capability-grid' },
    { id: 'resource-picker',  tag: 'atlas-resource-picker' },
  ];

  for (const { id, tag } of agentPrimitives) {
    test(`Batch Agent — specimens smoke "${id}" renders ${tag}`, async ({ page }) => {
      await openSpecimen(page, id);
      await expect(page.locator(tag).first()).toBeVisible();
    });
  }

  // Batch Mobile nav — specimens smoke. The two new chrome primitives
  // are mobile-first so we just verify their tag mounts. Active-state
  // and keyboard nav are exercised in the dedicated component tests.
  test.describe('Batch Mobile nav — specimens smoke', () => {
    const mobileNavSpecimens: Array<{ id: string; tag: string }> = [
      { id: 'app-bar',    tag: 'atlas-app-bar' },
      { id: 'bottom-nav', tag: 'atlas-bottom-nav' },
    ];

    for (const { id, tag } of mobileNavSpecimens) {
      test(`Mobile nav specimen "${id}" renders ${tag}`, async ({ page }) => {
        await openSpecimen(page, id);
        await expect(page.locator(tag).first()).toBeVisible();
      });
    }

    test('bottom-nav exposes role="tablist" and one selected item', async ({
      page,
    }) => {
      await openSpecimen(page, 'bottom-nav');
      const bar = page.locator('atlas-bottom-nav').first();
      await expect(bar).toHaveAttribute('role', 'tablist');
      await expect(
        bar.locator('atlas-bottom-nav-item[aria-selected="true"]').first(),
      ).toBeVisible();
    });

    test('app-bar implies role="banner"', async ({ page }) => {
      await openSpecimen(page, 'app-bar');
      const bar = page.locator('atlas-app-bar').first();
      await expect(bar).toHaveAttribute('role', 'banner');
    });
  });
  // Batch Popups — anchored overlay specimens.
  const popups: Array<{ id: string; tag: string }> = [
    { id: 'menu',    tag: 'atlas-menu' },
    { id: 'popover', tag: 'atlas-popover' },
  ];

  for (const { id, tag } of popups) {
    test(`Popups specimen "${id}" renders ${tag}`, async ({ page }) => {
      await openSpecimen(page, id);
      await expect(page.locator(tag).first()).toBeAttached();
    });
  }
});
