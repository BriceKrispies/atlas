/**
 * Register-templates test for @atlas/bundle-standard.
 *
 * Mirrors register.test.ts:
 *   1. Sets up a linkedom DOM so `AtlasElement.define(...)` works headlessly.
 *   2. Imports each template module (side-effect registers the custom element).
 *   3. Constructs a fresh TemplateRegistry, runs registerAllTemplates, and
 *      asserts both templates are present with valid manifests.
 *   4. Validates every seed page document against page_document.schema.json.
 *   5. Confirms every seed doc's templateId resolves in the template registry.
 *   6. Checks bundle.manifest.json's provides.templates list matches the
 *      two shipped template ids exactly.
 */

import { test, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// --- browser-ish globals BEFORE loading @atlas/core or template modules
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
// dry-run and register.test.ts.
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

const { TemplateRegistry, validateTemplateManifest, validatePageDocument } =
  await import('@atlas/page-templates');
const oneColumn = await import('../src/templates/one-column/index.ts');
const twoColumn = await import('../src/templates/two-column/index.ts');
const threeColumn = await import('../src/templates/three-column/index.ts');
const headerMainFooter = await import('../src/templates/header-main-footer/index.ts');
const heroAndGrid = await import('../src/templates/hero-and-grid/index.ts');
const dashboardTiles = await import('../src/templates/dashboard-tiles/index.ts');
const { registerAllTemplates } = await import('../src/register.ts');
const { seedPages, gallerySeedPages } = await import('../src/seed-pages/index.ts');

interface BundleManifestDoc {
  provides?: { templates?: string[] };
}

interface SeedDoc {
  pageId: string;
  templateId: string;
}

test('registerAllTemplates populates registry, seeds validate, and bundle manifest matches', async () => {
  // 1. Every manifest validates against the schema.
  const templateModules = [
    oneColumn,
    twoColumn,
    threeColumn,
    headerMainFooter,
    heroAndGrid,
    dashboardTiles,
  ];
  for (const mod of templateModules) {
    const result = validateTemplateManifest(mod.manifest);
    expect(
      result.ok,
      `manifest for ${mod.manifest.templateId} should be valid: ${JSON.stringify(result.errors)}`,
    ).toBe(true);
  }

  // 2. registerAllTemplates succeeds on a fresh registry and populates it.
  const registry = new TemplateRegistry();
  registerAllTemplates(registry);
  const expectedTemplateIds = [
    'template.one-column',
    'template.two-column',
    'template.three-column',
    'template.header-main-footer',
    'template.hero-and-grid',
    'template.dashboard-tiles',
  ];
  for (const templateId of expectedTemplateIds) {
    expect(registry.has(templateId), `registry should have ${templateId}`).toBe(true);
  }

  // 3. Every seed page document validates against page_document.schema.json.
  expect(Array.isArray(seedPages) && seedPages.length === 3, 'seedPages must contain three docs').toBe(true);
  expect(
    Array.isArray(gallerySeedPages) && gallerySeedPages.length === 4,
    'gallerySeedPages must contain four docs',
  ).toBe(true);
  for (const doc of [...seedPages, ...gallerySeedPages] as SeedDoc[]) {
    const result = validatePageDocument(doc);
    expect(
      result.ok,
      `seed page ${doc.pageId} should validate: ${JSON.stringify(result.errors)}`,
    ).toBe(true);
  }

  // 4. Each seed doc's templateId is present in the populated registry.
  const allSeeds = [...seedPages, ...gallerySeedPages] as SeedDoc[];
  expect(
    allSeeds.every((p) => registry.has(p.templateId)),
    `every seed doc's templateId must be registered, got ${allSeeds.map((p) => p.templateId).join(', ')}`,
  ).toBe(true);

  // 5. bundle.manifest.json's provides.templates matches exactly.
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '..', 'src', 'bundle.manifest.json');
  const bundleManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BundleManifestDoc;
  const declared = bundleManifest.provides?.templates ?? [];
  const expectedDeclared = expectedTemplateIds;
  expect(
    declared.length === expectedDeclared.length && expectedDeclared.every((t) => declared.includes(t)),
    `bundle.manifest.json provides.templates should be exactly ${JSON.stringify(expectedDeclared)}, got ${JSON.stringify(declared)}`,
  ).toBe(true);
});
