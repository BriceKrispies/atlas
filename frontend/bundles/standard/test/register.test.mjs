/**
 * Register test for @atlas/bundle-standard.
 *
 * Sets up a linkedom DOM so `AtlasSurface.define(...)` works headlessly,
 * constructs a fresh WidgetRegistry, runs registerAllWidgets, and
 * asserts that every advertised widgetId is present + has a manifest
 * that passes validateManifest. Also checks the bundle manifest's
 * provides.widgets list against the set of registered ids.
 */

import { parseHTML } from 'linkedom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- browser-ish globals BEFORE loading @atlas/core or widget modules
const dom = parseHTML(
  '<!doctype html><html><head></head><body></body></html>',
);
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.DocumentFragment = dom.DocumentFragment;
globalThis.customElements = dom.customElements;
globalThis.Node = dom.Node;
globalThis.NodeFilter = dom.NodeFilter ?? { SHOW_ELEMENT: 1 };
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

// linkedom lacks createTreeWalker; @atlas/core's html helper needs it
// to attach event bindings. Mirror the shim used in widget-host's
// dry-run.
if (typeof globalThis.document.createTreeWalker !== 'function') {
  globalThis.document.createTreeWalker = (root) => {
    const elements = [];
    const walk = (el) => {
      elements.push(el);
      for (const child of el.children ?? []) walk(child);
    };
    for (const child of root.children ?? []) walk(child);
    let i = -1;
    return {
      nextNode() {
        i += 1;
        return i < elements.length ? elements[i] : null;
      },
    };
  };
}

const { WidgetRegistry, validateManifest } = await import('@atlas/widget-host');
const announcements = await import('../src/widgets/announcements/index.js');
const messaging = await import('../src/widgets/messaging/index.js');
const uploader = await import('../src/widgets/spreadsheet-uploader/index.js');
const { registerAllWidgets } = await import('../src/register.js');

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`assertion failed: ${msg}`);
  }
}

async function main() {
  const registry = new WidgetRegistry();
  registerAllWidgets(registry);

  for (const widgetId of [
    'content.announcements',
    'comms.messaging',
    'import.spreadsheet-uploader',
  ]) {
    assert(registry.has(widgetId), `registry should have ${widgetId}`);
  }

  for (const mod of [announcements, messaging, uploader]) {
    const result = validateManifest(mod.manifest);
    assert(
      result.ok === true,
      `manifest for ${mod.manifest.widgetId} should be valid: ${JSON.stringify(result.errors)}`,
    );
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '..', 'src', 'bundle.manifest.json');
  const bundleManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  const declared = bundleManifest.provides?.widgets ?? [];
  const expected = [
    'content.announcements',
    'comms.messaging',
    'import.spreadsheet-uploader',
  ];
  assert(
    declared.length === expected.length && expected.every((w) => declared.includes(w)),
    `bundle.manifest.json provides.widgets should be exactly ${JSON.stringify(expected)}, got ${JSON.stringify(declared)}`,
  );

  console.log('OK');
}

main().catch((err) => {
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
