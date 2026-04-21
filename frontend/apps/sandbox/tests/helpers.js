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
  await page.waitForSelector(`button.item[data-id="${specimenId}"][aria-selected="true"]`);
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
 * Locator for a drop indicator at a specific region + index.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} region
 * @param {number} index
 */
export function dropIndicator(page, region, index) {
  return page.locator(
    `[data-testid="content-page.drop-indicator"][data-region="${region}"][data-index="${index}"]`,
  );
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
 * Pointer-drag a source element onto a target. Uses Pointer Events since
 * the editor listens for pointer*, not HTML5 drag-and-drop.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} source
 * @param {import('@playwright/test').Locator} target
 */
export async function pointerDrag(page, source, target) {
  const sbox = await source.boundingBox();
  if (!sbox) throw new Error('pointerDrag: source has no bounding box');
  const sx = sbox.x + sbox.width / 2;
  const sy = sbox.y + sbox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();

  // Pickup fires on pointerdown. Indicators grow (8px → 36px) which shifts
  // everything below. Recompute target box AFTER pickup so the mouse lands
  // on the live position, not the stale pre-pickup layout.
  const tbox = await target.boundingBox();
  if (!tbox) throw new Error('pointerDrag: target has no bounding box after pickup');
  const tx = tbox.x + tbox.width / 2;
  const ty = tbox.y + tbox.height / 2;

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
