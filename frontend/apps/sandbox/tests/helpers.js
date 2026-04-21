/**
 * Sandbox-specific Playwright helpers.
 *
 * The sandbox renders its sidebar and preview area inside a shadow root
 * on <atlas-sandbox>. Playwright's default locators pierce shadow DOM
 * transparently, so these helpers hide only the selector convention —
 * not any shadow-DOM trickery.
 */

/**
 * Load a specific specimen by id (e.g. "page.welcome"). Uses the URL
 * `?specimen=` param so the test isn't coupled to sidebar click order.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} specimenId
 */
export async function openSpecimen(page, specimenId) {
  await page.goto(`/?specimen=${encodeURIComponent(specimenId)}`);
  await page.waitForSelector(
    `atlas-nav-item.item[data-id="${specimenId}"][aria-selected="true"]`,
  );
}

/**
 * Switch to a configVariant by clicking its state-bar button.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} variantName — e.g. "View", "Edit"
 */
export async function selectVariant(page, variantName) {
  const slug = String(variantName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const tab = page.locator(`[data-testid="sandbox.variant-switcher.${slug}"]`);
  await tab.click();
  await expect_selected(tab);
}

async function expect_selected(locator) {
  const selected = await locator.getAttribute('aria-selected');
  if (selected !== 'true') {
    throw new Error(`Tab is not selected (aria-selected=${selected})`);
  }
}

/**
 * Locator for the nth widget cell inside a region.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} region
 * @param {number} index — 0-based
 */
export function widgetCell(page, region, index) {
  return page
    .locator(`section[data-slot="${region}"] > [data-widget-cell]`)
    .nth(index);
}

/**
 * Locator for the empty-region drop zone for a region, rendered during
 * an active drag when the region has no visible cells.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} region
 */
export function emptyDropZone(page, region) {
  return page.locator(
    `section[data-slot="${region}"] > [data-drop-empty][data-region="${region}"]`,
  );
}

/**
 * Pointer-drag a source element onto a specific half of a target cell.
 * Uses Pointer Events since the editor listens for pointer*, not HTML5
 * drag-and-drop.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} source
 * @param {import('@playwright/test').Locator} target
 * @param {{ half?: 'before' | 'after', offsetFraction?: number }} [options]
 *   half='before' aims the mouse at the top ~25% of the target; 'after'
 *   aims at the bottom ~25%. Default is the centre. offsetFraction
 *   overrides (0 = top edge, 1 = bottom edge).
 */
export async function pointerDrag(page, source, target, options = {}) {
  const sbox = await source.boundingBox();
  if (!sbox) throw new Error('pointerDrag: source has no bounding box');
  const sx = sbox.x + sbox.width / 2;
  const sy = sbox.y + sbox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();

  // Pickup fires on pointerdown. Layout can shift (source cell becomes
  // display:none, empty-drop zones appear) so recompute the target box
  // AFTER pickup.
  const tbox = await target.boundingBox();
  if (!tbox) throw new Error('pointerDrag: target has no bounding box after pickup');

  let fraction = 0.5;
  if (typeof options.offsetFraction === 'number') {
    fraction = options.offsetFraction;
  } else if (options.half === 'before') {
    fraction = 0.2;
  } else if (options.half === 'after') {
    fraction = 0.8;
  }
  const tx = tbox.x + tbox.width / 2;
  const ty = tbox.y + tbox.height * fraction;

  await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 4 });
  await page.mouse.up();
}

/**
 * Read the text contents of every widget in a region, in order. Useful
 * for asserting reorder results without caring about instanceIds.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} region
 */
export async function widgetTextsInRegion(page, region) {
  return page
    .locator(`section[data-slot="${region}"] > [data-widget-cell]`)
    .allInnerTexts();
}

/**
 * Set the viewport to a small phone size (iPhone SE) so responsive/mobile
 * assertions operate at the framework's mobile-first base breakpoint.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function setMobileViewport(page) {
  await page.setViewportSize({ width: 360, height: 640 });
}
