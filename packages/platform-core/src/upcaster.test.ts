import { describe, it, expect } from '@atlas/test';
import { UpcasterRegistry, upcastToLatest } from './upcaster.ts';
/**
 * Narrow an `unknown` attrs blob to a record so test upcasters can spread
 * it. The upcaster signature accepts `unknown` so production upcasters
 * must do their own narrowing — these test-only upcasters just need to
 * assert "row is an object" then return a new shape. Throws otherwise so
 * a regression that passes a non-object attrs row trips a clear failure
 * instead of a silent type-assertion shrug.
 */
function asRecord(attrs: unknown): Record<string, unknown> {
    if (typeof attrs !== 'object' || attrs === null) {
        throw new Error(`expected attrs to be an object, got ${typeof attrs}`);
    }
    return attrs as Record<string, unknown>;
}
describe('UpcasterRegistry', function () {
    it('latestVersion defaults to 1 with no upcasters registered', function () {
        const r = new UpcasterRegistry();
        expect(r.latestVersion('Page')).toBe(1);
    });
    it('register tracks latest known version', function () {
        const r = new UpcasterRegistry();
        r.register('Page', 1, function (a) {
            return a;
        });
        expect(r.latestVersion('Page')).toBe(2);
        r.register('Page', 2, function (a) {
            return a;
        });
        expect(r.latestVersion('Page')).toBe(3);
    });
    it('apply walks the chain in order', function () {
        const r = new UpcasterRegistry();
        r.register('Page', 1, function (attrs) {
            return ({ ...asRecord(attrs), v1to2: true });
        });
        r.register('Page', 2, function (attrs) {
            return ({ ...asRecord(attrs), v2to3: true });
        });
        const out = asRecord(r.apply('Page', 1, 3, { name: 'home' }));
        expect(out['name']).toBe('home');
        expect(out['v1to2']).toBe(true);
        expect(out['v2to3']).toBe(true);
    });
    it('apply is a no-op when fromVersion === toVersion', function () {
        const r = new UpcasterRegistry();
        expect(r.apply('Page', 3, 3, { name: 'home' })).toEqual({ name: 'home' });
    });
    it('apply throws on missing intermediate step', function () {
        const r = new UpcasterRegistry();
        r.register('Page', 1, function (a) {
            return a;
        });
        // No v2→v3 registered, but caller asks to walk to v3.
        expect(function () {
            return r.apply('Page', 1, 3, {});
        }).toThrow(/missing upcaster.*Page v2/);
    });
    it('apply rejects downgrade attempts', function () {
        const r = new UpcasterRegistry();
        expect(function () {
            return r.apply('Page', 3, 1, {});
        }).toThrow(/forward-only/);
    });
    it('register throws on conflicting upcasters', function () {
        const r = new UpcasterRegistry();
        const a = function (x: unknown): unknown {
            return x;
        };
        const b = function (x: unknown): unknown {
            return x;
        };
        r.register('Page', 1, a);
        expect(function () {
            return r.register('Page', 1, b);
        }).toThrow(/collision/);
    });
    it('register is idempotent for the same function reference', function () {
        const r = new UpcasterRegistry();
        const fn = function (x: unknown): unknown {
            return x;
        };
        r.register('Page', 1, fn);
        r.register('Page', 1, fn);
        expect(r.latestVersion('Page')).toBe(2);
    });
});
describe('upcastToLatest', function () {
    it('returns input unchanged when already at latest', function () {
        const r = new UpcasterRegistry();
        r.register('Page', 1, function (a) {
            return a;
        });
        const out = upcastToLatest(r, 'Page', 2, { name: 'home' });
        expect(out).toEqual({ schemaVersion: 2, attrs: { name: 'home' } });
    });
    it('walks chain to latest registered version', function () {
        const r = new UpcasterRegistry();
        r.register('Page', 1, function (attrs) {
            return ({ ...asRecord(attrs), upcasted: true });
        });
        const out = upcastToLatest(r, 'Page', 1, { name: 'home' });
        expect(out.schemaVersion).toBe(2);
        expect(asRecord(out.attrs)['upcasted']).toBe(true);
    });
});
