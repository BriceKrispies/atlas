/**
 * Manifest validation — positive + negative coverage.
 *
 * Ensures `validateManifest` accepts well-formed manifests and surfaces
 * structured errors for every constraint declared in
 * `widget_manifest.schema.json` (INV-WIDGET-01 / 02 / 03).
 */
import { describe, it, expect } from '@atlas/test';
import { validateManifest } from '../src/manifest.ts';
import type { WidgetManifest } from '../src/types.ts';
const valid: WidgetManifest = {
    widgetId: 'content.announcements',
    version: '1.0.0',
    displayName: 'Announcements',
    configSchema: 'ui.widget.announcements.config.v1',
    isolation: 'inline',
    capabilities: ['backend.query'],
};
describe('validateManifest — happy path', function () {
    it('accepts a minimal valid manifest', function () {
        const r = validateManifest(valid);
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
    });
    it('accepts a manifest with provides/consumes/deferredStates', function () {
        const r = validateManifest({
            ...valid,
            provides: { topics: ['a.published'] },
            consumes: { topics: ['b.requested'] },
            deferredStates: [
                { state: 'unauthorized', reason: 'public widget — never gated' },
            ],
        });
        expect(r.ok).toBe(true);
    });
    it('accepts each isolation mode', function () {
        for (const mode of ['inline', 'shadow', 'iframe'] as const) {
            const r = validateManifest({ ...valid, isolation: mode });
            expect(r.ok).toBe(true);
        }
    });
});
describe('validateManifest — required fields (INV-WIDGET-01)', function () {
    it('rejects when widgetId is missing', function () {
        const { widgetId: _, ...rest } = valid;
        void _;
        const r = validateManifest(rest);
        expect(r.ok).toBe(false);
        expect(r.errors.some(function (e) {
            return /widgetId/.test(e.message);
        })).toBe(true);
    });
    it('rejects when version is missing', function () {
        const { version: _, ...rest } = valid;
        void _;
        const r = validateManifest(rest);
        expect(r.ok).toBe(false);
    });
    it('rejects when displayName is missing', function () {
        const { displayName: _, ...rest } = valid;
        void _;
        const r = validateManifest(rest);
        expect(r.ok).toBe(false);
    });
    it('rejects when configSchema is missing', function () {
        const { configSchema: _, ...rest } = valid;
        void _;
        const r = validateManifest(rest);
        expect(r.ok).toBe(false);
    });
    it('rejects when isolation is missing', function () {
        const { isolation: _, ...rest } = valid;
        void _;
        const r = validateManifest(rest);
        expect(r.ok).toBe(false);
    });
});
describe('validateManifest — value constraints', function () {
    it('rejects widgetId without a dot (single-segment)', function () {
        const r = validateManifest({ ...valid, widgetId: 'announcements' });
        expect(r.ok).toBe(false);
    });
    it('rejects widgetId with uppercase (kebab-case rule)', function () {
        const r = validateManifest({ ...valid, widgetId: 'Content.Announcements' });
        expect(r.ok).toBe(false);
    });
    it('rejects non-semver version', function () {
        const r = validateManifest({ ...valid, version: '1.0' });
        expect(r.ok).toBe(false);
    });
    it('rejects unknown isolation mode', function () {
        const r = validateManifest({
            ...(valid as object),
            isolation: 'rocket',
        });
        expect(r.ok).toBe(false);
    });
    it('rejects empty displayName', function () {
        const r = validateManifest({ ...valid, displayName: '' });
        expect(r.ok).toBe(false);
    });
});
describe('validateManifest — capabilities grammar (INV-WIDGET-03)', function () {
    it('rejects a capability that is single-segment', function () {
        const r = validateManifest({ ...valid, capabilities: ['query'] });
        expect(r.ok).toBe(false);
    });
    it('rejects a capability with uppercase', function () {
        const r = validateManifest({
            ...valid,
            capabilities: ['Backend.Query'],
        });
        expect(r.ok).toBe(false);
    });
    it('rejects duplicate capability entries (uniqueItems)', function () {
        const r = validateManifest({
            ...valid,
            capabilities: ['backend.query', 'backend.query'],
        });
        expect(r.ok).toBe(false);
    });
});
describe('validateManifest — extra properties', function () {
    it('rejects unknown top-level properties (additionalProperties: false)', function () {
        const r = validateManifest({
            ...valid,
            surprise: 'pikachu',
        } satisfies object);
        expect(r.ok).toBe(false);
    });
});
