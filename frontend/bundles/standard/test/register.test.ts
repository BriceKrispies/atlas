/**
 * Register test for @atlas/bundle-standard.
 *
 * Sets up a linkedom DOM so `AtlasSurface.define(...)` works headlessly,
 * constructs a fresh WidgetRegistry, runs registerAllWidgets, and
 * asserts that every advertised widgetId is present + has a manifest
 * that passes validateManifest. Also checks the bundle manifest's
 * provides.widgets list against the set of registered ids.
 */

import { test, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- browser-ish globals BEFORE loading @atlas/core or widget modules
const dom = parseHTML(
  '<!doctype html><html><head></head><body></body></html>',
);
const g = globalThis as unknown as Record<string, unknown>;
g['window'] = dom.window;
g['document'] = dom.document;
g['HTMLElement'] = dom.HTMLElement;
g['DocumentFragment'] = dom.DocumentFragment;
g['customElements'] = dom.customElements;
g['Node'] = dom.Node;
g['NodeFilter'] = (dom as unknown as { NodeFilter?: unknown }).NodeFilter ?? { SHOW_ELEMENT: 1 };
if (!g['structuredClone']) {
  g['structuredClone'] = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
}

// linkedom lacks createTreeWalker; @atlas/core's html helper needs it
// to attach event bindings. Mirror the shim used in widget-host's
// dry-run.
interface TreeWalkable {
  children?: Iterable<TreeWalkable>;
}
const doc = dom.document as unknown as { createTreeWalker?: unknown };
if (typeof doc.createTreeWalker !== 'function') {
  doc.createTreeWalker = (root: TreeWalkable) => {
    const elements: TreeWalkable[] = [];
    const walk = (el: TreeWalkable): void => {
      elements.push(el);
      for (const child of el.children ?? []) walk(child);
    };
    for (const child of root.children ?? []) walk(child);
    let i = -1;
    return {
      nextNode(): TreeWalkable | null {
        i += 1;
        return i < elements.length ? (elements[i] ?? null) : null;
      },
    };
  };
}

const { WidgetRegistry, validateManifest } = await import('@atlas/widget-host');
const announcements = await import('../src/widgets/announcements/index.ts');
const messaging = await import('../src/widgets/messaging/index.ts');
const uploader = await import('../src/widgets/spreadsheet-uploader/index.ts');
const { registerAllWidgets } = await import('../src/register.ts');

interface BundleManifestDoc {
  provides?: { widgets?: string[] };
}

test('registerAllWidgets populates every advertised widget and bundle manifest matches', async () => {
  const registry = new WidgetRegistry();
  registerAllWidgets(registry);

  for (const widgetId of [
    'content.announcements',
    'comms.messaging',
    'import.spreadsheet-uploader',
  ]) {
    expect(registry.has(widgetId), `registry should have ${widgetId}`).toBe(true);
  }

  for (const mod of [announcements, messaging, uploader]) {
    const result = validateManifest(mod.manifest);
    expect(
      result.ok,
      `manifest for ${mod.manifest.widgetId} should be valid: ${JSON.stringify(result.errors)}`,
    ).toBe(true);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '..', 'src', 'bundle.manifest.json');
  const bundleManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BundleManifestDoc;

  const declared = bundleManifest.provides?.widgets ?? [];
  const expected = [
    'content.announcements',
    'comms.messaging',
    'import.spreadsheet-uploader',
  ];
  expect(
    declared.length === expected.length && expected.every((w) => declared.includes(w)),
    `bundle.manifest.json provides.widgets should be exactly ${JSON.stringify(expected)}, got ${JSON.stringify(declared)}`,
  ).toBe(true);
});
