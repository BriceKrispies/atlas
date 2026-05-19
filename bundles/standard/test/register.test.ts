/**
 * Register test for @atlas/bundle-standard.
 *
 * Linkedom DOM globals (window/document/HTMLElement/customElements/Node/
 * NodeFilter/createTreeWalker shim) are installed by the project-wide
 * vitest setup at `test-setup/linkedom-shims.ts` — see vitest.config.ts.
 * No inline shim needed here.
 *
 * Constructs a fresh WidgetRegistry, runs registerAllWidgets, and asserts
 * that every advertised widgetId is present + has a manifest that passes
 * validateManifest. Also checks the bundle manifest's provides.widgets
 * list against the set of registered ids.
 */
import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WidgetRegistry, validateManifest } from '@atlas/widget-host';
import * as announcements from '../src/widgets/announcements/index.ts';
import * as messaging from '../src/widgets/messaging/index.ts';
import * as uploader from '../src/widgets/spreadsheet-uploader/index.ts';
import { registerAllWidgets } from '../src/register.ts';
interface BundleManifestDoc {
    provides?: {
        widgets?: string[];
    };
}
function isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
/**
 * Narrow the parsed bundle.manifest.json to a typed view. Throws a
 * test-invariant error if the document doesn't match the documented shape
 * — the file is checked-in and machine-readable, so a shape mismatch is a
 * test-author bug at scope time, not runtime data we have to validate.
 */
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
    const widgets = provides['widgets'];
    if (widgets === undefined)
        return { provides: {} };
    if (!Array.isArray(widgets) ||
        !widgets.every(function (w): w is string {
            return typeof w === 'string';
        })) {
        throw new Error('Test invariant violation: bundle manifest `provides.widgets` is not a string[]');
    }
    return { provides: { widgets } };
}
test('registerAllWidgets populates every advertised widget and bundle manifest matches', async function () {
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
        expect(result.ok, `manifest for ${mod.manifest.widgetId} should be valid: ${JSON.stringify(result.errors)}`).toBe(true);
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const manifestPath = resolve(here, '..', 'src', 'bundle.manifest.json');
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bundleManifest = asBundleManifest(parsed);
    const declared = bundleManifest.provides?.widgets ?? [];
    const expected = [
        'content.announcements',
        'comms.messaging',
        'import.spreadsheet-uploader',
    ];
    expect(declared.length === expected.length && expected.every(function (w) {
        return declared.includes(w);
    }), `bundle.manifest.json provides.widgets should be exactly ${JSON.stringify(expected)}, got ${JSON.stringify(declared)}`).toBe(true);
});
