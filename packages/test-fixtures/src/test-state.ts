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

import type { Page } from '@playwright/test';

/**
 * Minimal shape of the registry exposed by `@atlas/test-state` on
 * `window.__atlasTest` in dev builds. Duplicated here so this package
 * does not need a runtime dependency on `@atlas/test-state`.
 */
interface AtlasTestApi {
  getState(): Record<string, unknown>;
  getChartState(id: string): unknown;
  getEditorState(id: string): unknown;
  getLayoutState(id: string | null): unknown;
  getDragState(surface?: string): unknown;
  getLastCommit(surfaceKey: string): unknown;
  keys(): string[];
}

declare global {
  interface Window {
    __atlasTest?: AtlasTestApi;
  }
}

export interface CommitShape {
  intent?: string;
  patch?: Record<string, unknown>;
}

export interface AssertCommittedOptions {
  timeout?: number;
  interval?: number;
}

export interface DragWidgetOptions {
  editorId: string;
  /** Selector for the dragged element. */
  from: string;
  /** Selector for the drop target. */
  to: string;
  /** Defaults to `'drop'`. */
  expectedIntent?: string;
  timeout?: number;
}

export interface ResizeWidgetOptions {
  editorId: string;
  /** Selector for the edge/corner handle. */
  handleSelector: string;
  dx?: number;
  dy?: number;
  timeout?: number;
}

export async function readTestState(page: Page): Promise<Record<string, unknown>> {
  return await page.evaluate(() => {
    if (!window.__atlasTest) throw new Error('atlas test registry not installed');
    return window.__atlasTest.getState();
  });
}

export async function readChartState(page: Page, id: string): Promise<unknown> {
  return await page.evaluate((chartId: string) => {
    if (!window.__atlasTest) throw new Error('atlas test registry not installed');
    return window.__atlasTest.getChartState(chartId);
  }, id);
}

export async function readEditorState(page: Page, id: string): Promise<unknown> {
  return await page.evaluate((editorId: string) => {
    if (!window.__atlasTest) throw new Error('atlas test registry not installed');
    return window.__atlasTest.getEditorState(editorId);
  }, id);
}

export async function readLayoutState(page: Page, id?: string): Promise<unknown> {
  return await page.evaluate((editorId: string | null) => {
    if (!window.__atlasTest) throw new Error('atlas test registry not installed');
    return window.__atlasTest.getLayoutState(editorId);
  }, id ?? null);
}

export async function readDragState(page: Page, surface: string = 'layout'): Promise<unknown> {
  return await page.evaluate((s: string) => {
    if (!window.__atlasTest) throw new Error('atlas test registry not installed');
    return window.__atlasTest.getDragState(s);
  }, surface);
}

/**
 * Poll `__atlasTest.getLastCommit(surfaceKey)` until its `intent` and any
 * provided patch fields match the shape. Returns the matching commit.
 *
 * Shape match rules:
 *   - `intent` must equal shape.intent if provided
 *   - every key in `shape.patch` must exist in commit.patch with a
 *     deep-equal value (commit.patch may have extra keys)
 */
export async function assertCommitted(
  page: Page,
  surfaceKey: string,
  shape: CommitShape,
  opts: AssertCommittedOptions = {},
): Promise<unknown> {
  const timeout = opts.timeout ?? 2000;
  const interval = opts.interval ?? 40;
  const deadline = Date.now() + timeout;

  let last: unknown = null;
  while (Date.now() < deadline) {
    last = await page.evaluate((key: string) => {
      if (!window.__atlasTest) return null;
      return window.__atlasTest.getLastCommit(key);
    }, surfaceKey);
    if (last && matchesShape(last, shape)) return last;
    await new Promise<void>((r) => setTimeout(r, interval));
  }
  throw new Error(
    `assertCommitted timeout for ${surfaceKey} — expected ${JSON.stringify(shape)}, last was ${JSON.stringify(last)}`,
  );
}

function matchesShape(commit: unknown, shape: CommitShape): boolean {
  if (!commit || typeof commit !== 'object') return false;
  const c = commit as { intent?: unknown; patch?: unknown };
  if (shape.intent !== undefined && c.intent !== shape.intent) return false;
  if (shape.patch !== undefined) {
    if (!c.patch || typeof c.patch !== 'object') return false;
    const commitPatch = c.patch as Record<string, unknown>;
    for (const [k, v] of Object.entries(shape.patch)) {
      if (!deepEqual(commitPatch[k], v)) return false;
    }
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

/**
 * Drag a widget from one element to another using pointer events (so
 * it drives the real HTML5 DnD wiring). Asserts that a `drop` commit
 * lands on the editor surface.
 */
export async function dragWidget(page: Page, opts: DragWidgetOptions): Promise<unknown> {
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
  await page.mouse.move(
    startX + (endX - startX) * 0.25,
    startY + (endY - startY) * 0.25,
    { steps: 4 },
  );
  await page.mouse.move(
    startX + (endX - startX) * 0.5,
    startY + (endY - startY) * 0.5,
    { steps: 4 },
  );
  await page.mouse.move(endX, endY, { steps: 6 });
  await page.mouse.up();

  return await assertCommitted(
    page,
    `editor:${editorId}`,
    { intent: expectedIntent },
    timeout !== undefined ? { timeout } : {},
  );
}

/**
 * Resize a widget by dragging its edge handle. Asserts a `resize` commit
 * lands on the editor surface.
 */
export async function resizeWidget(page: Page, opts: ResizeWidgetOptions): Promise<unknown> {
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

  return await assertCommitted(
    page,
    `editor:${editorId}`,
    { intent: 'resize' },
    timeout !== undefined ? { timeout } : {},
  );
}
