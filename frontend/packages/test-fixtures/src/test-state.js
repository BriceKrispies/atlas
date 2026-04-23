/**
 * Playwright helpers for reading the dev-only `window.__atlasTest`
 * registry installed by `@atlas/test-state`.
 *
 * Every interactive surface registers a reader keyed by
 * `chart:<id>`, `editor:<id>`, `drag:<surface>`, etc. The reader returns
 * a JSON-safe snapshot of that surface's state, including `lastCommit`.
 *
 * These helpers are test-only — they assume the bundle was built with
 * `import.meta.env.DEV === true` (i.e. `vite` or `vite dev`). In a prod
 * build the registry does not exist and these helpers will throw
 * "atlas test registry not installed" so tests fail loud.
 */

/** @param {import('@playwright/test').Page} page */
export async function readTestState(page) {
  return await page.evaluate(() => {
    if (!window.__atlasTest) throw new Error('atlas test registry not installed');
    return window.__atlasTest.getState();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
export async function readChartState(page, id) {
  return await page.evaluate(
    (chartId) => {
      if (!window.__atlasTest) throw new Error('atlas test registry not installed');
      return window.__atlasTest.getChartState(chartId);
    },
    id,
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
export async function readEditorState(page, id) {
  return await page.evaluate(
    (editorId) => {
      if (!window.__atlasTest) throw new Error('atlas test registry not installed');
      return window.__atlasTest.getEditorState(editorId);
    },
    id,
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} [id]
 */
export async function readLayoutState(page, id) {
  return await page.evaluate(
    (editorId) => {
      if (!window.__atlasTest) throw new Error('atlas test registry not installed');
      return window.__atlasTest.getLayoutState(editorId);
    },
    id ?? null,
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} [surface]
 */
export async function readDragState(page, surface = 'layout') {
  return await page.evaluate(
    (s) => {
      if (!window.__atlasTest) throw new Error('atlas test registry not installed');
      return window.__atlasTest.getDragState(s);
    },
    surface,
  );
}

/**
 * Poll `__atlasTest.getLastCommit(surfaceKey)` until its `intent` and any
 * provided patch fields match the shape. Returns the matching commit.
 *
 * Shape match rules:
 *   - `intent` must equal shape.intent if provided
 *   - every key in `shape.patch` must exist in commit.patch with a
 *     deep-equal value (commit.patch may have extra keys)
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} surfaceKey — e.g. `chart:sales`, `editor:page-1`
 * @param {{ intent?: string, patch?: Record<string, unknown> }} shape
 * @param {{ timeout?: number, interval?: number }} [opts]
 */
export async function assertCommitted(page, surfaceKey, shape, opts = {}) {
  const timeout = opts.timeout ?? 2000;
  const interval = opts.interval ?? 40;
  const deadline = Date.now() + timeout;

  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(
      (key) => {
        if (!window.__atlasTest) return null;
        return window.__atlasTest.getLastCommit(key);
      },
      surfaceKey,
    );
    if (last && matchesShape(last, shape)) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `assertCommitted timeout for ${surfaceKey} — expected ${JSON.stringify(shape)}, last was ${JSON.stringify(last)}`,
  );
}

function matchesShape(commit, shape) {
  if (shape.intent !== undefined && commit.intent !== shape.intent) return false;
  if (shape.patch !== undefined) {
    if (!commit.patch || typeof commit.patch !== 'object') return false;
    for (const [k, v] of Object.entries(shape.patch)) {
      if (!deepEqual(commit.patch[k], v)) return false;
    }
  }
  return true;
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Drag a widget from one element to another using pointer events (so
 * it drives the real HTML5 DnD wiring). Asserts that a `drop` commit
 * lands on the editor surface.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   editorId: string,
 *   from: string,           // selector for the dragged element
 *   to: string,              // selector for the drop target
 *   expectedIntent?: string, // defaults to 'drop'
 *   timeout?: number,
 * }} opts
 */
export async function dragWidget(page, opts) {
  const { editorId, from, to, expectedIntent = 'drop', timeout } = opts;

  const fromHandle = await page.waitForSelector(from);
  const toHandle = await page.waitForSelector(to);
  const fromBox = await fromHandle.boundingBox();
  const toBox = await toHandle.boundingBox();
  if (!fromBox || !toBox) throw new Error('dragWidget: source or target has no bounding box');

  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const endX = toBox.x + toBox.width / 2;
  const endY = toBox.y + toBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in 3 hops so HTML5 DnD dragover fires reliably
  await page.mouse.move(startX + (endX - startX) * 0.25, startY + (endY - startY) * 0.25, { steps: 4 });
  await page.mouse.move(startX + (endX - startX) * 0.5, startY + (endY - startY) * 0.5, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 6 });
  await page.mouse.up();

  return await assertCommitted(page, `editor:${editorId}`, { intent: expectedIntent }, { timeout });
}

/**
 * Resize a widget by dragging its edge handle. Asserts a `resize` commit
 * lands on the editor surface.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   editorId: string,
 *   handleSelector: string,  // selector for the edge/corner handle
 *   dx?: number,
 *   dy?: number,
 *   timeout?: number,
 * }} opts
 */
export async function resizeWidget(page, opts) {
  const { editorId, handleSelector, dx = 0, dy = 0, timeout } = opts;

  const handle = await page.waitForSelector(handleSelector);
  const box = await handle.boundingBox();
  if (!box) throw new Error('resizeWidget: handle has no bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx / 2, startY + dy / 2, { steps: 4 });
  await page.mouse.move(startX + dx, startY + dy, { steps: 6 });
  await page.mouse.up();

  return await assertCommitted(page, `editor:${editorId}`, { intent: 'resize' }, { timeout });
}
