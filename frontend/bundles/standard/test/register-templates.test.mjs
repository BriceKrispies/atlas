/**
 * Register-templates test for @atlas/bundle-standard.
 *
 * Mirrors register.test.mjs:
 *   1. Sets up a linkedom DOM so `AtlasElement.define(...)` works headlessly.
 *   2. Imports each template module (side-effect registers the custom element).
 *   3. Constructs a fresh TemplateRegistry, runs registerAllTemplates, and
 *      asserts both templates are present with valid manifests.
 *   4. Validates every seed page document against page_document.schema.json.
 *   5. Confirms every seed doc's templateId resolves in the template registry.
 *   6. Checks bundle.manifest.json's provides.templates list matches the
 *      two shipped template ids exactly.
 */

import { parseHTML } from 'linkedom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- browser-ish globals BEFORE loading @atlas/core or template modules
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
// dry-run and register.test.mjs.
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

const { TemplateRegistry, validateTemplateManifest, validatePageDocument } =
  await import('@atlas/page-templates');
const oneColumn = await import('../src/templates/one-column/index.js');
const twoColumn = await import('../src/templates/two-column/index.js');
const { registerAllTemplates } = await import('../src/register.js');
const { seedPages } = await import('../src/seed-pages/index.js');

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`assertion failed: ${msg}`);
  }
}

async function main() {
  // 1. Both manifests validate against the schema.
  for (const mod of [oneColumn, twoColumn]) {
    const result = validateTemplateManifest(mod.manifest);
    assert(
      result.ok === true,
      `manifest for ${mod.manifest.templateId} should be valid: ${JSON.stringify(result.errors)}`,
    );
  }

  // 2. registerAllTemplates succeeds on a fresh registry and populates it.
  const registry = new TemplateRegistry();
  registerAllTemplates(registry);
  for (const templateId of ['template.one-column', 'template.two-column']) {
    assert(registry.has(templateId), `registry should have ${templateId}`);
  }

  // 3. Every seed page document validates against page_document.schema.json.
  assert(Array.isArray(seedPages) && seedPages.length === 3, 'seedPages must contain three docs');
  for (const doc of seedPages) {
    const result = validatePageDocument(doc);
    assert(
      result.ok === true,
      `seed page ${doc.pageId} should validate: ${JSON.stringify(result.errors)}`,
    );
  }

  // 4. Each seed doc's templateId is present in the populated registry.
  assert(
    seedPages.every((p) => registry.has(p.templateId)),
    `every seed doc's templateId must be registered, got ${seedPages.map((p) => p.templateId).join(', ')}`,
  );

  // 5. bundle.manifest.json's provides.templates matches exactly.
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '..', 'src', 'bundle.manifest.json');
  const bundleManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const declared = bundleManifest.provides?.templates ?? [];
  const expected = ['template.one-column', 'template.two-column'];
  assert(
    declared.length === expected.length && expected.every((t) => declared.includes(t)),
    `bundle.manifest.json provides.templates should be exactly ${JSON.stringify(expected)}, got ${JSON.stringify(declared)}`,
  );

  console.log('OK');
}

main().catch((err) => {
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
