/**
 * Sandbox-specific Playwright helpers.
 *
 * The editor is built around an imperative, instance-keyed EditorAPI and
 * explicit <atlas-box data-drop-slot> DOM elements (one per empty region
 * — filled regions render no slot). Every slot, cell, and cell-chrome
 * control has a unique `name` attribute that becomes a stable
 * auto-generated data-testid, so tests never need pointer-geometry math.
 *
 * Drag is handled by the internal DnD subsystem (Pointer Events, not the
 * native HTML5 DnD API). For reliable mutations in tests prefer the
 * bypass-UI helper `runEditorOp(page, ...)`; to exercise the sensor
 * end-to-end, use `page.mouse.down/move/up` on real coordinates.
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
  const selected = await tab.getAttribute('aria-selected');
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
 * Locator for a region's drop slot. Each region section is the slot; in
 * edit mode an EMPTY slot carries `data-empty="true"` and accepts drops.
 * A filled slot has no `data-empty` and ignores drops (so the locator
 * below only matches empty slots — that's the "droppable slot").
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} region
 */
export function dropSlot(page, region) {
  return page.locator(
    `section[data-editor-slot="${region}"][data-empty="true"]`,
  );
}

/**
 * Locator for the delete button on a cell, keyed by instanceId.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} instanceId
 */
export function deleteButton(page, instanceId) {
  return page.locator(`[data-testid="content-page.delete-${instanceId}"]`);
}

/**
 * Locator for the drag handle on a cell, keyed by instanceId.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} instanceId
 */
export function dragHandle(page, instanceId) {
  return page.locator(`[data-testid="content-page.drag-handle-${instanceId}"]`);
}

/**
 * Locator for a palette chip by widgetId.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} widgetId
 */
export function paletteChip(page, widgetId) {
  return page.locator(
    `[data-testid="widget-palette.palette-chip-${widgetId}"]`,
  );
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
 * Read the ordered instanceIds of widgets in a region.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} region
 */
export async function widgetInstanceIdsInRegion(page, region) {
  return page
    .locator(`section[data-slot="${region}"] > [data-widget-cell]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-instance-id')));
}

/**
 * Wait for a <content-page> to have its imperative editor API attached.
 * Must be called after selectVariant('Edit'), before any runEditorOp /
 * chrome-click assertion that depends on the editor being live.
 *
 * The sandbox app mounts specimens inside <atlas-sandbox>'s shadow root,
 * so `document.querySelector('content-page[...]')` returns null — we have
 * to walk shadow roots breadth-first.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} pageId
 */
export async function waitForEditor(page, pageId) {
  await page.waitForFunction(
    (pid) => {
      const deepFind = (id) => {
        const stack = [document];
        while (stack.length) {
          const root = stack.shift();
          const found =
            root.querySelector && root.querySelector(`content-page[data-page-id="${id}"]`);
          if (found) return found;
          const descendants = root.querySelectorAll
            ? Array.from(root.querySelectorAll('*'))
            : [];
          for (const el of descendants) {
            if (el.shadowRoot) stack.push(el.shadowRoot);
          }
        }
        return null;
      };
      const cp = deepFind(pid);
      return !!(cp && cp.editor);
    },
    pageId,
  );
}

/**
 * Call the imperative editor API exposed at contentPageEl.editor.
 * Use this when a test wants to drive a mutation the way an agent or
 * another surface would — skipping the UI entirely. Returns the API's
 * result object (`{ ok, ... }`).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} pageId
 * @param {'add'|'move'|'update'|'remove'|'list'|'get'|'can'} op
 * @param {object} [args]
 */
export async function runEditorOp(page, pageId, op, args) {
  return page.evaluate(
    ({ pageId, op, args }) => {
      const deepFind = (id) => {
        const stack = [document];
        while (stack.length) {
          const root = stack.shift();
          const found =
            root.querySelector && root.querySelector(`content-page[data-page-id="${id}"]`);
          if (found) return found;
          const descendants = root.querySelectorAll
            ? Array.from(root.querySelectorAll('*'))
            : [];
          for (const el of descendants) {
            if (el.shadowRoot) stack.push(el.shadowRoot);
          }
        }
        return null;
      };
      const cp = deepFind(pageId);
      if (!cp || !cp.editor) return { ok: false, reason: 'editor-not-attached' };
      const fn = cp.editor[op];
      if (typeof fn !== 'function') return { ok: false, reason: 'op-not-found' };
      return fn.call(cp.editor, args);
    },
    { pageId, op, args },
  );
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
