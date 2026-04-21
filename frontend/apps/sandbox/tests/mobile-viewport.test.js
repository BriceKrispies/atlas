import { test, expect } from '@playwright/test';
import { openSpecimen, setMobileViewport } from './helpers.js';

/**
 * Mobile-first viewport contract.
 *
 * Runs every primary atlas-* specimen at a 360×640 phone viewport and
 * asserts:
 *   (1) the document does not introduce a horizontal scrollbar (WCAG 1.4.10),
 *   (2) every rendered interactive element meets the 44×44 CSS-px touch
 *       target (WCAG 2.5.5).
 *
 * The per-specimen element-selector set is small on purpose — the point
 * is to catch regressions in the design tokens + shadow-DOM CSS, not to
 * exhaustively enumerate every specimen variant.
 */

const INTERACTIVE_SPECIMENS = [
  { id: 'button', selector: 'atlas-button' },
  { id: 'input', selector: 'atlas-input' },
  { id: 'nav', selector: 'atlas-nav-item' },
];

test.describe('design system — mobile viewport contract', () => {
  test.beforeEach(async ({ page }) => {
    await setMobileViewport(page);
  });

  for (const { id, selector } of INTERACTIVE_SPECIMENS) {
    test(`${id}: no horizontal scroll and 44×44 touch targets at 360px`, async ({ page }) => {
      await openSpecimen(page, id);

      // (1) No horizontal document scroll.
      const overflowsX = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth + 1;
      });
      expect(overflowsX, 'document should not horizontally scroll').toBe(false);

      // (2) Every rendered interactive element in the specimen preview
      // meets the 44×44 minimum. Some specimens show multiple variants
      // (sm, primary, ghost) — every one must pass.
      const elements = await page.locator(selector).all();
      expect(elements.length, `${selector} must render at least once`).toBeGreaterThan(0);
      for (const el of elements) {
        const box = await el.boundingBox();
        if (!box) continue; // hidden variant — skip
        expect(box.width, `${selector} width ≥ 44`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${selector} height ≥ 44`).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test('tokens expose --atlas-touch-target-min and breakpoint custom properties', async ({ page }) => {
    await openSpecimen(page, 'button');
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        touch: s.getPropertyValue('--atlas-touch-target-min').trim(),
        bpSm: s.getPropertyValue('--atlas-bp-sm').trim(),
        bpMd: s.getPropertyValue('--atlas-bp-md').trim(),
        bpLg: s.getPropertyValue('--atlas-bp-lg').trim(),
      };
    });
    expect(tokens.touch).toBe('44px');
    expect(tokens.bpSm).toBe('640px');
    expect(tokens.bpMd).toBe('900px');
    expect(tokens.bpLg).toBe('1200px');
  });
});
