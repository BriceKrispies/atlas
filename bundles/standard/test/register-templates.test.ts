/**
 * Register-templates test for @atlas/bundle-standard.
 *
 * Linkedom DOM globals (window/document/HTMLElement/customElements/Node/
 * NodeFilter/createTreeWalker shim) are installed by the project-wide
 * vitest setup at `test-setup/linkedom-shims.ts` — see vitest.config.ts.
 * No inline shim needed here.
 *
 *   1. Imports each template module (side-effect registers the custom element).
 *   2. Constructs a fresh TemplateRegistry, runs registerAllTemplates, and
 *      asserts both templates are present with valid manifests.
 *   3. Validates every seed page document against page_document.schema.json.
 *   4. Confirms every seed doc's templateId resolves in the template registry.
 *   5. Checks bundle.manifest.json's provides.templates list matches the
 *      shipped template ids exactly.
 */
import { test, expect } from '@atlas/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TemplateRegistry, validateTemplateManifest, validatePageDocument } from '@atlas/page-templates';
import * as oneColumn from '../src/templates/one-column/index.ts';
import * as twoColumn from '../src/templates/two-column/index.ts';
import * as threeColumn from '../src/templates/three-column/index.ts';
import * as headerMainFooter from '../src/templates/header-main-footer/index.ts';
import * as heroAndGrid from '../src/templates/hero-and-grid/index.ts';
import * as dashboardTiles from '../src/templates/dashboard-tiles/index.ts';
import { registerAllTemplates } from '../src/register.ts';
import { seedPages, gallerySeedPages } from '../src/seed-pages/index.ts';
interface BundleManifestDoc {
    provides?: {
        templates?: string[];
    };
}
interface SeedDoc {
    pageId: string;
    templateId: string;
}
/** Boundary: seed-pages export is `ReadonlyArray<unknown>` because the
 *  JSON-imported documents have no compile-time shape. Runtime-check the
 *  two fields this test actually reads, then narrow once. */
function isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
/**
 * Narrow an `unknown` seed-page entry to a typed view that retains the
 * full original document (for downstream schema validation) while
 * exposing pageId/templateId as typed fields.
 */
type SeedView = SeedDoc & {
    raw: unknown;
};
function asSeedDoc(v: unknown, source: string): SeedView {
    if (!isRecord(v)) {
        throw new Error(`Test invariant violation: ${source} is not an object`);
    }
    const pageId = v['pageId'];
    const templateId = v['templateId'];
    if (typeof pageId !== 'string' || typeof templateId !== 'string') {
        throw new Error(`Test invariant violation: ${source} missing pageId/templateId`);
    }
    return { pageId, templateId, raw: v };
}
function asBundleManifest(v: unknown): BundleManifestDoc {
    if (!isRecord(v)) {
        throw new Error('Test invariant violation: bundle.manifest.json did not parse to an object');
    }
    const provides = v['provides'];
    if (provides == null)
        return {};
    if (!isRecord(provides)) {
        throw new Error('Test invariant violation: bundle manifest `provides` is not an object');
    }
    const templates = provides['templates'];
    if (templates === undefined)
        return { provides: {} };
    if (!Array.isArray(templates) || !templates.every(function (t): t is string {
        return typeof t === 'string';
    })) {
        throw new Error('Test invariant violation: bundle manifest `provides.templates` is not a string[]');
    }
    return { provides: { templates } };
}
test('registerAllTemplates populates registry, seeds validate, and bundle manifest matches', async function () {
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
        expect(result.ok, `manifest for ${mod.manifest.templateId} should be valid: ${JSON.stringify(result.errors)}`).toBe(true);
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
    expect(Array.isArray(gallerySeedPages) && gallerySeedPages.length === 4, 'gallerySeedPages must contain four docs').toBe(true);
    const allSeeds: SeedView[] = [
        ...seedPages.map(function (v, i) {
            return asSeedDoc(v, `seedPages[${i}]`);
        }),
        ...gallerySeedPages.map(function (v, i) {
            return asSeedDoc(v, `gallerySeedPages[${i}]`);
        }),
    ];
    for (const doc of allSeeds) {
        const result = validatePageDocument(doc.raw);
        expect(result.ok, `seed page ${doc.pageId} should validate: ${JSON.stringify(result.errors)}`).toBe(true);
    }
    // 4. Each seed doc's templateId is present in the populated registry.
    expect(allSeeds.every(function (p) {
        return registry.has(p.templateId);
    }), `every seed doc's templateId must be registered, got ${allSeeds.map(function (p) {
        return p.templateId;
    }).join(', ')}`).toBe(true);
    // 5. bundle.manifest.json's provides.templates matches exactly.
    const here = dirname(fileURLToPath(import.meta.url));
    const manifestPath = resolve(here, '..', 'src', 'bundle.manifest.json');
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bundleManifest = asBundleManifest(parsed);
    const declared = bundleManifest.provides?.templates ?? [];
    const expectedDeclared = expectedTemplateIds;
    expect(declared.length === expectedDeclared.length && expectedDeclared.every(function (t) {
        return declared.includes(t);
    }), `bundle.manifest.json provides.templates should be exactly ${JSON.stringify(expectedDeclared)}, got ${JSON.stringify(declared)}`).toBe(true);
});
